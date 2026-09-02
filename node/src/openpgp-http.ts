import type { IncomingMessage, ServerResponse } from "node:http";
import type { Hex } from "viem";
import { wkdHuHash } from "../../client/src/openpgp-identity.ts";
import { toWrappedPrivateHex, type OpenPgpKeyStore } from "./openpgp-keys.ts";

export type OpenPgpHttpOpts = {
  store: OpenPgpKeyStore;
  domain: string;
  isOptedIn: (name: string, nodeKey: Hex) => Promise<boolean>;
  nodeKey: Hex;
  mailboxName: (domain: string, address: string) => string | null;
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** WKD direct method + openpgp key publish/fetch for the mailbox. */
export async function handleOpenPgpHttp(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  opts: OpenPgpHttpOpts,
): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/.well-known/openpgpkey/policy") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("");
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/.well-known/openpgpkey/hu/")) {
    const hu = decodeURIComponent(url.pathname.slice("/.well-known/openpgpkey/hu/".length)).toLowerCase();
    let record = opts.store.getByHu(hu);
    const local = url.searchParams.get("l");
    if (!record && local) {
      record = opts.store.getByHu(wkdHuHash(local));
    }
    if (!record) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return true;
    }
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "access-control-allow-origin": "*",
    });
    res.end(record.publicArmored);
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/openpgp/")) {
    const name = decodeURIComponent(url.pathname.slice("/openpgp/".length));
    const record = opts.store.getByName(name);
    if (!record) {
      json(res, 404, { error: "not found" });
      return true;
    }
    json(res, 200, {
      email: record.email,
      publicArmored: record.publicArmored,
      wrappedPrivateHex: record.wrappedPrivateHex,
      hu: record.hu,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname.startsWith("/openpgp/")) {
    const name = decodeURIComponent(url.pathname.slice("/openpgp/".length));
    if (!(await opts.isOptedIn(name, opts.nodeKey))) {
      json(res, 403, { error: "not opted in" });
      return true;
    }
    const body = (await readJson(req)) as {
      email?: string;
      publicArmored?: string;
      wrappedPrivateHex?: Hex;
    };
    const email = (body.email ?? "").trim().toLowerCase();
    if (!body.publicArmored || !body.wrappedPrivateHex || !email) {
      json(res, 400, { error: "invalid" });
      return true;
    }
    const local = opts.mailboxName(opts.domain, email);
    if (local !== name) {
      json(res, 400, { error: "email mismatch" });
      return true;
    }
    const record = opts.store.set({
      name,
      email,
      publicArmored: body.publicArmored,
      wrappedPrivateHex: body.wrappedPrivateHex,
    });
    json(res, 200, { ok: true, hu: record.hu });
    return true;
  }

  return false;
}

export { toWrappedPrivateHex };
