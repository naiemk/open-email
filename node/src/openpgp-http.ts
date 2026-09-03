import type { IncomingMessage, ServerResponse } from "node:http";
import type { Hex } from "viem";
import * as openpgp from "openpgp";
import { wkdHuHash } from "../../client/src/openpgp-identity.ts";
import { toWrappedPrivateHex, type OpenPgpKeyStore } from "./openpgp-keys.ts";

export type OpenPgpHttpOpts = {
  store: OpenPgpKeyStore;
  domain: string;
  isOptedIn: (name: string, nodeKey: Hex) => Promise<boolean>;
  nodeKey: Hex;
  mailboxName: (domain: string, address: string) => string | undefined;
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

/** WKD direct or advanced path → hu segment (RFC 7929). */
export function parseWkdHuPath(pathname: string): string | null {
  const path = decodeURIComponent(pathname);
  const direct = path.match(/^\/\.well-known\/openpgpkey\/hu\/([^/]+)$/i);
  if (direct) return direct[1]!.toLowerCase();
  const advanced = path.match(/^\/\.well-known\/openpgpkey\/[^/]+\/hu\/([^/]+)$/i);
  if (advanced) return advanced[1]!.toLowerCase();
  return null;
}

/** RFC 7929: WKD GET returns binary transferable OpenPGP key material. */
export async function wkdPublicKeyBytes(publicArmored: string): Promise<Uint8Array> {
  const key = await openpgp.readKey({ armoredKey: publicArmored });
  return key.write();
}

function resolveWkdRecord(
  store: OpenPgpKeyStore,
  hu: string,
  local: string | null,
): ReturnType<OpenPgpKeyStore["getByHu"]> {
  let record = store.getByHu(hu);
  if (!record && local) {
    record = store.getByHu(wkdHuHash(local));
  }
  return record;
}

const WKD_HEADERS = {
  "content-type": "application/octet-stream",
  "access-control-allow-origin": "*",
} as const;

/** WKD direct + advanced method + openpgp key publish/fetch for the mailbox. */
export async function handleOpenPgpHttp(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  opts: OpenPgpHttpOpts,
): Promise<boolean> {
  if (
    (req.method === "GET" || req.method === "HEAD") &&
    url.pathname === "/.well-known/openpgpkey/policy"
  ) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(req.method === "HEAD" ? undefined : "");
    return true;
  }

  const hu = parseWkdHuPath(url.pathname);
  if (hu && (req.method === "GET" || req.method === "HEAD")) {
    const local = url.searchParams.get("l");
    const record = resolveWkdRecord(opts.store, hu, local);
    if (!record) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(req.method === "HEAD" ? undefined : "not found");
      return true;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, WKD_HEADERS);
      res.end();
      return true;
    }
    const binary = await wkdPublicKeyBytes(record.publicArmored);
    res.writeHead(200, WKD_HEADERS);
    res.end(Buffer.from(binary));
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
