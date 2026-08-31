import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { SMTPServer } from "smtp-server";
import { hexToBytes, type Hex } from "viem";
import { sealEnvelope } from "../../client/src/envelope.ts";
import { signIndexWrite, type MailIndex } from "../../dal/src/indexLog.ts";
import type { BlobStore } from "../../dal/src/storage.ts";

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
};

export type RunningNode = {
  domain: string;
  smtpPort: number;
  url: string;
  close: () => Promise<void>;
};

export async function startNode(config: NodeConfig): Promise<RunningNode> {
  const uiJs = await bundleUi();
  const trashByName = new Map<string, Set<number>>();
  const smtp = new SMTPServer({
    disabledCommands: ["AUTH", "STARTTLS"],
    hideSTARTTLS: true,
    onRcptTo(address, _session, callback) {
      const local = localPart(address.address);
      void config.registry.isOptedIn(local, config.nodeKey).then((ok) => {
        if (!ok) {
          callback(smtpError("No such user here", 550));
          return;
        }
        if (config.index.totalSize(local) >= config.index.cap) {
          callback(smtpError("Insufficient storage", 452));
          return;
        }
        callback();
      });
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
        void ingest(config, localPart(rcpt), rfc5322)
          .then(() => callback())
          .catch((err: unknown) => callback(err instanceof Error ? err : new Error(String(err))));
      });
    },
  });

  const smtpPort = await new Promise<number>((resolve, reject) => {
    const netServer = smtp.listen(config.smtpPort ?? 0, "127.0.0.1", () => {
      const addr = netServer.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("smtp has no port"));
        return;
      }
      resolve(addr.port);
    });
  });

  const http = createHttpServer((req, res) => {
    void handleHttp(req, res, config, uiJs, trashByName);
  });
  const httpPort = await new Promise<number>((resolve, reject) => {
    http.listen(config.httpPort ?? 0, "127.0.0.1", () => {
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

async function ingest(config: NodeConfig, name: string, rfc5322: Uint8Array): Promise<void> {
  const record = await config.registry.nameRecord(name);
  const blob = await sealEnvelope(hexToBytes(record.dekPublic), name, rfc5322);
  const size = blob.byteLength;
  if (config.index.totalSize(name) + size > config.index.cap) {
    throw smtpError("Insufficient storage", 452);
  }
  const cid = await config.blobs.pin(blob);
  const time = Math.floor(Date.now() / 1000);
  const direction = "in" as const;
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

function localPart(address: string): string {
  return address.split("@")[0] ?? address;
}

async function bundleUi(): Promise<string> {
  const entry = fileURLToPath(new URL("./ui.ts", import.meta.url));
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    write: false,
    platform: "browser",
  });
  const file = result.outputFiles[0];
  if (!file) throw new Error("ui bundle empty");
  return file.text;
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  config: NodeConfig,
  uiJs: string,
  trashByName: Map<string, Set<number>>,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://node.local");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(uiHtml(config.domain));
      return;
    }
    if (req.method === "GET" && url.pathname === "/ui.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(uiJs);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/index/")) {
      const name = decodeURIComponent(url.pathname.slice("/index/".length));
      const trashed = trashByName.get(name) ?? new Set();
      json(
        res,
        200,
        config.index.list(name).map((row) => ({ ...row, trashed: trashed.has(row.seq) })),
      );
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
      json(res, 200, await config.registry.nameRecord(name));
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : "failed" });
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function uiHtml(domain: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${domain}</title></head>
<body>
  <h1>${domain}</h1>
  <p>This UI talks only to this node. Unlock with your device KEK (WebAuthn PRF).</p>
  <label>OE id <input id="name" value="alice"></label>
  <label>KEK hex <input id="kek" size="64"></label>
  <button type="button" id="unlock">Unlock</button>
  <ul id="list"></ul>
  <pre id="body"></pre>
  <script type="module" src="/ui.js"></script>
</body>
</html>`;
}
