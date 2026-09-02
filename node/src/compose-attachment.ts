import type { IncomingMessage, ServerResponse } from "node:http";
import type { Hex } from "viem";
import {
  createComposeAttachmentStore,
  MAX_COMPOSE_ATTACHMENT_BYTES,
  type ComposeAttachmentStore,
} from "./compose-attachments.ts";

export type ComposeAttachmentConfig = {
  store: ComposeAttachmentStore;
  isOptedIn: (name: string, nodeKey: Hex) => Promise<boolean>;
  nodeKey: Hex;
};

export async function handleComposeAttachment(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  opts: ComposeAttachmentConfig,
): Promise<boolean> {
  if (req.method === "POST" && url.pathname.startsWith("/compose-attachment/")) {
    const name = decodeURIComponent(url.pathname.slice("/compose-attachment/".length));
    if (!name) {
      json(res, 400, { error: "invalid" });
      return true;
    }
    if (!(await opts.isOptedIn(name, opts.nodeKey))) {
      json(res, 403, { error: "not opted in" });
      return true;
    }
    const filename = (url.searchParams.get("filename") ?? "attachment").slice(0, 255);
    const mimeType = (url.searchParams.get("mimeType") ?? "application/octet-stream").slice(0, 127);
    try {
      const bytes = await readBodyLimited(req, MAX_COMPOSE_ATTACHMENT_BYTES);
      const id = opts.store.put(name, filename, mimeType, bytes);
      json(res, 200, { id, filename, mimeType, size: bytes.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "body too large") {
        json(res, 413, { error: "too large" });
        return true;
      }
      if (msg === "attachment too large" || msg === "staging full") {
        json(res, 413, { error: msg.replace(" ", "_") });
        return true;
      }
      json(res, 500, { error: "upload failed" });
    }
    return true;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/compose-attachment/")) {
    const rest = url.pathname.slice("/compose-attachment/".length);
    const slash = rest.lastIndexOf("/");
    if (slash <= 0) {
      json(res, 400, { error: "invalid" });
      return true;
    }
    const name = decodeURIComponent(rest.slice(0, slash));
    const id = decodeURIComponent(rest.slice(slash + 1));
    if (!(await opts.isOptedIn(name, opts.nodeKey))) {
      json(res, 403, { error: "not opted in" });
      return true;
    }
    if (!opts.store.remove(name, id)) {
      json(res, 404, { error: "not found" });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBodyLimited(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export { createComposeAttachmentStore };
