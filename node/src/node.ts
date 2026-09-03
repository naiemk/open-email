import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SMTPServer } from "smtp-server";
import { hexToBytes, type Hex } from "viem";
import { sealEnvelope } from "../../client/src/envelope.ts";
import { signIndexWrite, type MailIndex, normalizeIndexGeneration } from "../../dal/src/indexLog.ts";
import type { BlobStore } from "../../dal/src/storage.ts";
import { createCredentialWrapStore, type CredentialWrapStore } from "./credential-wraps.ts";
import { isLinkedEnsName, mailboxName as resolveMailboxName } from "./mailbox-name.ts";
import { handleSignup, type SignupConfig } from "./signup.ts";
import { createHitWindow } from "./rateLimit.ts";
import { handleSend, smtpFromAddress, type SendConfig } from "./send.ts";
import { handleComposeAttachment, createComposeAttachmentStore } from "./compose-attachment.ts";
import type { ComposeAttachmentStore } from "./compose-attachments.ts";
import { signDkim } from "./dkim.ts";
import { createPairStore, handlePair, type PairStore } from "./pair.ts";
import { handleServicePair } from "./service-pair.ts";
import { createMailboxStateStore, type MailboxStateStore } from "./mailbox-state.ts";
import { createOpenPgpKeyStore, type OpenPgpKeyStore } from "./openpgp-keys.ts";
import { handleOpenPgpHttp } from "./openpgp-http.ts";
import { serveUiAsset, uiDistExists } from "./ui-static.ts";
import { resolveGeo, resolvePayLocale } from "./geo.ts";
import { payStrings } from "./pay-i18n.ts";

export type NodeConfig = {
  domain: string;
  nodeKey: Hex;
  nodeSecret: Uint8Array;
  registry: {
    isOptedIn: (name: string, nodeKey: Hex) => Promise<boolean>;
    nameRecord: (name: string) => Promise<{ dekPublic: Hex; wrappedDek: Hex }>;
    mailboxGeneration: (name: string) => Promise<number>;
  };
  ensGate?: {
    allowsReceive: (name: string) => Promise<boolean>;
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
  relayerUrl?: string;
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
  const dataDir = config.dataDir ?? mkdtempSync(join(tmpdir(), "open-email-node-"));
  const credentialWraps = createCredentialWrapStore(`${dataDir}/credential-wraps.json`);
  const pair = createPairStore();
  const mailboxState = createMailboxStateStore(`${dataDir}/mailbox-state.json`);
  const composeAttachments = createComposeAttachmentStore(dataDir);
  const openPgpKeys = createOpenPgpKeyStore(`${dataDir}/openpgp-keys.json`);
  const sendHits = createHitWindow();
  const optHits = createHitWindow();
  const now = () => config.send?.now?.() ?? Date.now();
  const takeSendSlot = (name: string) => sendHits.take(name, now(), 20, 100);
  const takeOptSlot = (name: string) => optHits.take(name, now(), 2, 6);
  const smtp = new SMTPServer({
    disabledCommands: ["AUTH", "STARTTLS"],
    hideSTARTTLS: true,
    onRcptTo(address, session, callback) {
      const rcptName = resolveMailboxName(config.domain, address.address);
      if (rcptName) {
        void canReceive(config, rcptName).then((ok) => {
          if (!ok) {
            callback(smtpError("No such user here", 550));
            return;
          }
          void config.registry.mailboxGeneration(rcptName).then((generation) => {
            const gen = normalizeIndexGeneration(generation);
            if (config.index.totalSize(rcptName, gen) >= config.index.cap) {
              callback(smtpError("Insufficient storage", 452));
              return;
            }
            callback();
          });
        });
        return;
      }
      const mailFrom = typeof session.envelope.mailFrom === "object" && session.envelope.mailFrom
        ? session.envelope.mailFrom.address
        : "";
      const fromName = resolveMailboxName(config.domain, mailFrom);
      if (fromName && config.send) {
        void canReceive(config, fromName).then((ok) => {
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
        const rcptName = resolveMailboxName(config.domain, rcpt);
        if (rcptName) {
          void ingest(config, rcptName, rfc5322, "in")
            .then(() => callback())
            .catch((err: unknown) => callback(err instanceof Error ? err : new Error(String(err))));
          return;
        }
        const mailFrom = typeof session.envelope.mailFrom === "object" && session.envelope.mailFrom
          ? session.envelope.mailFrom.address
          : "";
        const fromName = resolveMailboxName(config.domain, mailFrom);
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
    void handleHttp(
      req,
      res,
      config,
      credentialWraps,
      pair,
      mailboxState,
      composeAttachments,
      openPgpKeys,
      takeSendSlot,
      takeOptSlot,
    );
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
  const [record, rawGeneration] = await Promise.all([
    config.registry.nameRecord(name),
    config.registry.mailboxGeneration(name),
  ]);
  const generation = normalizeIndexGeneration(rawGeneration);
  const blob = await sealEnvelope(hexToBytes(record.dekPublic), name, rfc5322);
  const size = blob.byteLength;
  if (config.index.totalSize(name, generation) + size > config.index.cap) {
    throw smtpError("Insufficient storage", 452);
  }
  const cid = await config.blobs.pin(blob);
  const time = Math.floor(Date.now() / 1000);
  await config.index.append({
    name,
    generation,
    time,
    cid,
    size,
    direction,
    nodeKey: config.nodeKey,
    signature: signIndexWrite(config.nodeSecret, name, generation, time, cid, size, direction),
  });
}

async function canReceive(config: NodeConfig, name: string): Promise<boolean> {
  if (!(await config.registry.isOptedIn(name, config.nodeKey))) return false;
  if (isLinkedEnsName(name) && config.ensGate) {
    if (!(await config.ensGate.allowsReceive(name))) return false;
  }
  return true;
}

function smtpError(message: string, responseCode: number): Error {
  return Object.assign(new Error(message), { responseCode });
}

export { resolveMailboxName as mailboxName };

function permanentlyDelete(
  config: NodeConfig,
  mailboxState: MailboxStateStore,
  name: string,
  seqs: number[],
): void {
  if (!seqs.length) return;
  const cids = config.index.remove(name, seqs);
  mailboxState.clearTrashFlags(name, seqs);
  for (const cid of cids) config.blobs.unpin(cid);
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  config: NodeConfig,
  credentialWraps: CredentialWrapStore,
  pair: PairStore,
  mailboxState: MailboxStateStore,
  composeAttachments: ComposeAttachmentStore,
  openPgpKeys: OpenPgpKeyStore,
  takeSendSlot: (name: string) => boolean,
  takeOptSlot: (name: string) => boolean,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://node.local");
  try {
    if (await handlePair(req, url, res, pair, credentialWraps)) return;
    if (await handleServicePair(req, url, res, config, credentialWraps)) return;
    if (
      await handleOpenPgpHttp(req, url, res, {
        store: openPgpKeys,
        domain: config.domain,
        isOptedIn: (name, nodeKey) => config.registry.isOptedIn(name, nodeKey),
        nodeKey: config.nodeKey,
        mailboxName: resolveMailboxName,
      })
    ) {
      return;
    }
    if (
      config.signup &&
      (await handleSignup(req, url, res, config.signup, config.nodeKey, takeOptSlot))
    ) {
      return;
    }
    if (
      config.send &&
      (await handleComposeAttachment(req, url, res, {
        store: composeAttachments,
        isOptedIn: (name, nodeKey) => config.registry.isOptedIn(name, nodeKey),
        nodeKey: config.nodeKey,
      }))
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
        composeAttachments,
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
        disableTurnstile: Boolean(config.signup?.disableTurnstile),
        turnstileSiteKey: config.signup?.disableTurnstile ? "" : (config.signup?.turnstileSiteKey ?? ""),
        signupPrice: config.signupPrice ?? "5.00",
        uiBuilt: uiDistExists(),
        mockPasskey: Boolean(config.devMode?.mockPasskey),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/geo") {
      json(res, 200, resolveGeo(req));
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
    if ((config.signup || config.relayerUrl) && url.pathname.startsWith("/api/")) {
      await proxyRelayer(
        req,
        url,
        res,
        config.signup?.relayerUrl ?? config.relayerUrl!,
        takeOptSlot,
      );
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
      res.end(payHtml(id, returnUrl, resolvePayLocale(req)));
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/index/")) {
      const name = decodeURIComponent(url.pathname.slice("/index/".length));
      const generation = normalizeIndexGeneration(await config.registry.mailboxGeneration(name));
      const newestFirst = [...config.index.list(name, generation)]
        .reverse()
        .map((row) => mailboxState.mergeRow(name, row));
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
    if (req.method === "GET" && url.pathname.startsWith("/mail-labels/")) {
      const name = decodeURIComponent(url.pathname.slice("/mail-labels/".length));
      json(res, 200, { labels: mailboxState.listLabels(name) });
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/mail-state/")) {
      const name = decodeURIComponent(url.pathname.slice("/mail-state/".length));
      const raw = await readBody(req);
      const body = JSON.parse(raw.toString("utf8") || "{}") as {
        updates?: Array<{ seq: number } & Record<string, unknown>>;
      };
      const updates = body.updates ?? [];
      if (!updates.length) {
        json(res, 400, { error: "invalid" });
        return;
      }
      mailboxState.patch(
        name,
        updates.map((u) => ({
          seq: u.seq,
          read: u.read as boolean | undefined,
          starred: u.starred as boolean | undefined,
          archived: u.archived as boolean | undefined,
          spam: u.spam as boolean | undefined,
          trashed: u.trashed as boolean | undefined,
          labels: u.labels as string[] | undefined,
          snoozeUntil: u.snoozeUntil as number | undefined,
        })),
      );
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/storage/")) {
      const name = decodeURIComponent(url.pathname.slice("/storage/".length));
      const generation = normalizeIndexGeneration(await config.registry.mailboxGeneration(name));
      const total_size = config.index.totalSize(name, generation);
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
      mailboxState.trash(name, seq);
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/restore/")) {
      const rest = url.pathname.slice("/restore/".length);
      const slash = rest.lastIndexOf("/");
      const name = decodeURIComponent(rest.slice(0, slash));
      const seq = Number(rest.slice(slash + 1));
      mailboxState.restore(name, seq);
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/empty-trash/")) {
      const name = decodeURIComponent(url.pathname.slice("/empty-trash/".length));
      permanentlyDelete(config, mailboxState, name, mailboxState.trashedSeqs(name));
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/delete/")) {
      const rest = url.pathname.slice("/delete/".length);
      const slash = rest.lastIndexOf("/");
      const name = decodeURIComponent(rest.slice(0, slash));
      const seq = Number(rest.slice(slash + 1));
      if (!mailboxState.getFlags(name, seq).trashed) {
        json(res, 400, { error: "not in trash" });
        return;
      }
      permanentlyDelete(config, mailboxState, name, [seq]);
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/blobs/")) {
      const cid = decodeURIComponent(url.pathname.slice("/blobs/".length));
      const name = url.searchParams.get("name") ?? "";
      const generation = name
        ? normalizeIndexGeneration(await config.registry.mailboxGeneration(name))
        : 1;
      if (!name || !config.index.list(name, generation).some((row) => row.cid === cid)) {
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
    path === "/link-challenge" ||
    path === "/remove-controller-challenge" ||
    path === "/opt-in" ||
    path === "/opt-out" ||
    path === "/link" ||
    path === "/remove-controller" ||
    path.startsWith("/opted-in/") ||
    path.startsWith("/names/") ||
    path.startsWith("/nodes/") ||
    path.startsWith("/invite-used/");
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

function payHtml(id: string, returnUrl: string, locale: string): string {
  const safeReturn = returnUrl.replace(/"/g, "&quot;");
  const s = payStrings(locale);
  const dir = locale === "ar" || locale === "fa" ? "rtl" : "ltr";
  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"><title>${s.title}</title></head>
<body>
  <p>${s.checkout(id)}</p>
  <button type="button" id="pay">${s.markPaid}</button>
  <p><a href="${safeReturn}">${s.returnLabel}</a></p>
  <script>
    document.getElementById("pay").onclick = async () => {
      await fetch("/signup/invoice/${id}/pay", { method: "POST" });
      window.location.href = "${safeReturn}";
    };
  </script>
</body>
</html>`;
}

