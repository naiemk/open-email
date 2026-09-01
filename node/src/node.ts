import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SMTPServer } from "smtp-server";
import { hexToBytes, type Hex } from "viem";
import { sealEnvelope } from "../../client/src/envelope.ts";
import { signIndexWrite, type MailIndex } from "../../dal/src/indexLog.ts";
import type { BlobStore } from "../../dal/src/storage.ts";
import { createCredentialWrapStore, type CredentialWrapStore } from "./credential-wraps.ts";
import { handleSignup, type SignupConfig } from "./signup.ts";
import { createHitWindow } from "./rateLimit.ts";
import { handleSend, smtpFromAddress, type SendConfig } from "./send.ts";
import { signDkim } from "./dkim.ts";
import { createPairStore, handlePair, type PairStore } from "./pair.ts";
import { serveUiAsset, uiDistExists } from "./ui-static.ts";

export type NodeConfig = {
  domain: string;
  nodeKey: Hex;
  nodeSecret: Uint8Array;
  registry: {
    isOptedIn: (name: string, nodeKey: Hex) => Promise<boolean>;
    nameRecord: (name: string) => Promise<{ dekPublic: Hex; wrappedDek: Hex }>;
  };
  blobs: BlobStore;
  index: MailIndex;
  smtpPort?: number;
  httpPort?: number;
  bindHost?: string;
  signup?: SignupConfig;
  send?: SendConfig;
  dataDir?: string;
  signupPrice?: string;
  devMode?: {
    mockPasskey: boolean;
    mockConfig?: {
      oeId: string;
      credentialId: Hex;
      qx: Hex;
      qy: Hex;
      secretHex: Hex;
    };
  };
};

export type RunningNode = {
  domain: string;
  smtpPort: number;
  url: string;
  close: () => Promise<void>;
};

export async function startNode(config: NodeConfig): Promise<RunningNode> {
  const dataDir = config.dataDir ?? "/data";
  const credentialWraps = createCredentialWrapStore(`${dataDir}/credential-wraps.json`);
  const pair = createPairStore();
  const trashByName = new Map<string, Set<number>>();
  const sendHits = createHitWindow();
  const optHits = createHitWindow();
  const now = () => config.send?.now?.() ?? Date.now();
  const takeSendSlot = (name: string) => sendHits.take(name, now(), 20, 100);
  const takeOptSlot = (name: string) => optHits.take(name, now(), 2, 6);
  const smtp = new SMTPServer({
    disabledCommands: ["AUTH", "STARTTLS"],
    hideSTARTTLS: true,
    onRcptTo(address, session, callback) {
      const rcptName = mailboxName(config, address.address);
      if (rcptName) {
        void config.registry.isOptedIn(rcptName, config.nodeKey).then((ok) => {
          if (!ok) {
            callback(smtpError("No such user here", 550));
            return;
          }
          if (config.index.totalSize(rcptName) >= config.index.cap) {
            callback(smtpError("Insufficient storage", 452));
            return;
          }
          callback();
        });
        return;
      }
      const mailFrom = typeof session.envelope.mailFrom === "object" && session.envelope.mailFrom
        ? session.envelope.mailFrom.address
        : "";
      const fromName = mailboxName(config, mailFrom);
      if (fromName && config.send) {
        void config.registry.isOptedIn(fromName, config.nodeKey).then((ok) => {
          if (!ok) {
            callback(smtpError("No such user here", 550));
            return;
          }
          callback();
        });
        return;
      }
      callback(smtpError("No such user here", 550));
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        const rfc5322 = new Uint8Array(Buffer.concat(chunks));
        const rcpt = session.envelope.rcptTo[0]?.address;
        if (!rcpt) {
          callback(new Error("no recipient"));
          return;
        }
        const rcptName = mailboxName(config, rcpt);
        if (rcptName) {
          void ingest(config, rcptName, rfc5322, "in")
            .then(() => callback())
            .catch((err: unknown) => callback(err instanceof Error ? err : new Error(String(err))));
          return;
        }
        const mailFrom = typeof session.envelope.mailFrom === "object" && session.envelope.mailFrom
          ? session.envelope.mailFrom.address
          : "";
        const fromName = mailboxName(config, mailFrom);
        if (!fromName || !config.send) {
          callback(smtpError("No such user here", 550));
          return;
        }
        const from = smtpFromAddress(config.domain, fromName);
        const signed = signDkim(rewriteFrom(new TextDecoder().decode(rfc5322), from), config.send.dkim);
        if (!takeSendSlot(fromName)) {
          callback(smtpError("Rate limited", 452));
          return;
        }
        void ingest(config, fromName, new TextEncoder().encode(signed), "out")
          .then(() => config.send!.deliver({ mailFrom: from, rcptTo: rcpt, data: signed }))
          .then((code) => {
            if (code >= 400) {
              callback(smtpError("Delivery failed", 451));
              return;
            }
            callback();
          })
          .catch((err: unknown) => callback(err instanceof Error ? err : new Error(String(err))));
      });
    },
  });

  const smtpPort = await new Promise<number>((resolve, reject) => {
    const netServer = smtp.listen(config.smtpPort ?? 0, config.bindHost ?? "127.0.0.1", () => {
      const addr = netServer.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("smtp has no port"));
        return;
      }
      resolve(addr.port);
    });
  });

  const http = createHttpServer((req, res) => {
    void handleHttp(req, res, config, credentialWraps, pair, trashByName, takeSendSlot, takeOptSlot);
  });
  const httpPort = await new Promise<number>((resolve, reject) => {
    http.listen(config.httpPort ?? 0, config.bindHost ?? "127.0.0.1", () => {
      const addr = http.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("http has no port"));
        return;
      }
      resolve(addr.port);
    });
  });

  return {
    domain: config.domain,
    smtpPort,
    url: `http://127.0.0.1:${httpPort}`,
    close: async () => {
      await new Promise<void>((resolve) => smtp.close(() => resolve()));
      await new Promise<void>((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

async function ingest(
  config: NodeConfig,
  name: string,
  rfc5322: Uint8Array,
  direction: "in" | "out",
): Promise<void> {
  const record = await config.registry.nameRecord(name);
  const blob = await sealEnvelope(hexToBytes(record.dekPublic), name, rfc5322);
  const size = blob.byteLength;
  if (config.index.totalSize(name) + size > config.index.cap) {
    throw smtpError("Insufficient storage", 452);
  }
  const cid = await config.blobs.pin(blob);
  const time = Math.floor(Date.now() / 1000);
  await config.index.append({
    name,
    time,
    cid,
    size,
    direction,
    nodeKey: config.nodeKey,
    signature: signIndexWrite(config.nodeSecret, name, time, cid, size, direction),
  });
}

function smtpError(message: string, responseCode: number): Error {
  return Object.assign(new Error(message), { responseCode });
}

/** SMTP `{oe-id}@testnet.crypted.email` maps to registry name `{oe-id}.testnet`. */
function mailboxName(config: NodeConfig, address: string): string | undefined {
  const at = address.lastIndexOf("@");
  const local = (at === -1 ? address : address.slice(0, at)).toLowerCase();
  const host = (at === -1 ? "" : address.slice(at + 1)).toLowerCase();
  if (host !== config.domain.toLowerCase()) return undefined;
  if (config.domain.toLowerCase() === "testnet.crypted.email") {
    if (local.includes(".")) return undefined;
    return `${local}.testnet`;
  }
  return local;
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  config: NodeConfig,
  credentialWraps: CredentialWrapStore,
  pair: PairStore,
  trashByName: Map<string, Set<number>>,
  takeSendSlot: (name: string) => boolean,
  takeOptSlot: (name: string) => boolean,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://node.local");
  try {
    if (await handlePair(req, url, res, pair, credentialWraps)) return;
    if (
      config.signup &&
      (await handleSignup(req, url, res, config.signup, config.nodeKey, takeOptSlot))
    ) {
      return;
    }
    if (
      config.send &&
      (await handleSend(req, url, res, {
        domain: config.domain,
        nodeKey: config.nodeKey,
        send: config.send,
        isOptedIn: (name, nodeKey) => config.registry.isOptedIn(name, nodeKey),
        takeSendSlot,
        ingest: (name, rfc5322, direction) => ingest(config, name, rfc5322, direction),
      }))
    ) {
      return;
    }
    if (req.method === "GET" && url.pathname === "/") {
      if (serveUiAsset("/", res)) return;
      json(res, 503, { error: "ui not built — run npm run build:ui" });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      if (serveUiAsset(url.pathname, res)) return;
      json(res, 404, { error: "not found" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/meta") {
      json(res, 200, {
        domain: config.domain,
        nodeKey: config.nodeKey,
        fakeCheckout: Boolean(config.signup?.fakeCheckout),
        turnstileSiteKey: config.signup?.turnstileSiteKey ?? "",
        signupPrice: config.signupPrice ?? "5.00",
        uiBuilt: uiDistExists(),
        mockPasskey: Boolean(config.devMode?.mockPasskey),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/dev/mock-config") {
      const cfg = config.devMode?.mockConfig;
      if (!cfg) {
        json(res, 404, { error: "not available" });
        return;
      }
      json(res, 200, cfg);
      return;
    }
    if (config.signup && url.pathname.startsWith("/api/")) {
      await proxyRelayer(req, url, res, config.signup.relayerUrl, takeOptSlot);
      return;
    }
    if (req.method === "GET" && url.pathname === "/pay") {
      const id = url.searchParams.get("id") ?? "";
      if (!config.signup?.fakeCheckout || !config.signup.invoices.get(id)) {
        json(res, 404, { error: "not found" });
        return;
      }
      const returnUrl = `${url.origin}/?signup=${encodeURIComponent(id)}&paid=1`;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(payHtml(id, returnUrl));
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/index/")) {
      const name = decodeURIComponent(url.pathname.slice("/index/".length));
      const trashed = trashByName.get(name) ?? new Set();
      const newestFirst = [...config.index.list(name)]
        .reverse()
        .map((row) => ({ ...row, trashed: trashed.has(row.seq) }));
      const before = Number(url.searchParams.get("before") ?? "");
      const limitRaw = Number(url.searchParams.get("limit") ?? 100);
      const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100, 100);
      const page = (Number.isFinite(before) && before > 0 ? newestFirst.filter((r) => r.seq < before) : newestFirst).slice(
        0,
        limit,
      );
      json(res, 200, page);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/storage/")) {
      const name = decodeURIComponent(url.pathname.slice("/storage/".length));
      const total_size = config.index.totalSize(name);
      json(res, 200, {
        total_size,
        cap: config.index.cap,
        warn: total_size >= Math.floor(config.index.cap * 0.8),
      });
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/trash/")) {
      const rest = url.pathname.slice("/trash/".length);
      const slash = rest.lastIndexOf("/");
      const name = decodeURIComponent(rest.slice(0, slash));
      const seq = Number(rest.slice(slash + 1));
      const set = trashByName.get(name) ?? new Set();
      set.add(seq);
      trashByName.set(name, set);
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/empty-trash/")) {
      const name = decodeURIComponent(url.pathname.slice("/empty-trash/".length));
      const seqs = [...(trashByName.get(name) ?? new Set())];
      const cids = config.index.remove(name, seqs);
      trashByName.delete(name);
      for (const cid of cids) config.blobs.unpin(cid);
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/blobs/")) {
      const cid = decodeURIComponent(url.pathname.slice("/blobs/".length));
      const name = url.searchParams.get("name") ?? "";
      if (!name || !config.index.list(name).some((row) => row.cid === cid)) {
        json(res, 404, { error: "unknown cid" });
        return;
      }
      const bytes = await config.blobs.get(cid);
      if (!bytes) {
        json(res, 404, { error: "unknown cid" });
        return;
      }
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(Buffer.from(bytes));
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/bootstrap/")) {
      const name = decodeURIComponent(url.pathname.slice("/bootstrap/".length));
      const credentialId = url.searchParams.get("credentialId") ?? "";
      const local = credentialId ? credentialWraps.get(credentialId) : undefined;
      if (local && local.name === name) {
        json(res, 200, { wrappedDek: local.wrappedDek, source: "node" });
        return;
      }
      json(res, 200, { ...(await config.registry.nameRecord(name)), source: "registry" });
      return;
    }
    if (serveUiAsset(url.pathname, res)) return;
    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : "failed" });
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function proxyRelayer(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  relayerUrl: string,
  takeOptSlot: (name: string) => boolean,
): Promise<void> {
  const path = url.pathname.slice("/api".length);
  const allowed =
    path === "/register-challenge" ||
    path === "/opt-in-challenge" ||
    path === "/opt-out-challenge" ||
    path === "/opt-in" ||
    path === "/opt-out" ||
    path.startsWith("/opted-in/");
  if (!allowed) {
    json(res, 404, { error: "not found" });
    return;
  }
  const headers: Record<string, string> = {};
  if (req.headers["content-type"]) headers["content-type"] = String(req.headers["content-type"]);
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await readBody(req);
    if ((path === "/opt-in" || path === "/opt-out") && !takeOptSlot(nameFromJson(body))) {
      json(res, 429, { error: "rate" });
      return;
    }
    init.body = new Uint8Array(body);
  }
  try {
    const proxied = await fetch(`${relayerUrl}${path}${url.search}`, init);
    const buf = Buffer.from(await proxied.arrayBuffer());
    res.writeHead(proxied.status, {
      "content-type": proxied.headers.get("content-type") ?? "application/json",
    });
    res.end(buf);
  } catch (err) {
    json(res, 502, {
      error: `relayer unreachable (${relayerUrl}): ${err instanceof Error ? err.message : "fetch failed"}`,
    });
  }
}

function nameFromJson(body: Buffer): string {
  try {
    const parsed = JSON.parse(body.toString("utf8") || "{}") as { name?: string };
    return parsed.name ?? "";
  } catch {
    return "";
  }
}

function rewriteFrom(rfc5322: string, from: string): string {
  const msg = rfc5322.includes("\r\n") ? rfc5322 : rfc5322.replace(/\n/g, "\r\n");
  if (/^From:/im.test(msg)) return msg.replace(/^From:.*$/im, `From: ${from}`);
  return `From: ${from}\r\n${msg}`;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function payHtml(id: string, returnUrl: string): string {
  const safeReturn = returnUrl.replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Pay</title></head>
<body>
  <p>Testnet checkout for invoice ${id}.</p>
  <button type="button" id="pay">Mark paid (test only)</button>
  <p><a href="${safeReturn}">Return to mailbox signup</a></p>
  <script>
    document.getElementById("pay").onclick = async () => {
      await fetch("/signup/invoice/${id}/pay", { method: "POST" });
      window.location.href = "${safeReturn}";
    };
  </script>
</body>
</html>`;
}

