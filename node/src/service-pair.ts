import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { bytesToHex, padHex, type Hex } from "viem";
import { encodeInvite, signInvite, type ServiceInvite } from "../../client/src/pair-blob.ts";
import type { CredentialWrapStore } from "./credential-wraps.ts";
import type { NodeConfig } from "./node.ts";

const INVITE_TTL_MS = 10 * 60_000;

export async function handleServicePair(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  config: NodeConfig,
  credentialWraps: CredentialWrapStore,
): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/pair/invite-sign") {
    const body = (await readJson(req)) as {
      name?: string;
      qx?: Hex;
      qy?: Hex;
      guestPub?: Hex;
    };
    const name = (body.name ?? "").trim();
    const qx = body.qx ?? ("" as Hex);
    const qy = body.qy ?? ("" as Hex);
    const guestPub = body.guestPub ?? ("" as Hex);
    if (!name || !qx || !qy || !guestPub) {
      json(res, 400, { error: "invalid" });
      return true;
    }
    const inviteId = padHex(bytesToHex(randomBytes(16)), { size: 32 }) as Hex;
    const unsigned: Omit<ServiceInvite, "sig"> = {
      v: 1,
      inviteId,
      name,
      domain: config.domain,
      nodeKey: config.nodeKey,
      qx,
      qy,
      guestPub,
      exp: Date.now() + INVITE_TTL_MS,
    };
    const invite = signInvite(unsigned, config.nodeSecret);
    json(res, 200, { invite, blob: encodeInvite(invite) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/pair/service-wrap") {
    const body = (await readJson(req)) as { name?: string; credentialId?: Hex; wrappedDek?: Hex };
    if (!body.name || !body.credentialId || !body.wrappedDek) {
      json(res, 400, { error: "invalid" });
      return true;
    }
    credentialWraps.set({
      name: body.name,
      credentialId: body.credentialId,
      wrappedDek: body.wrappedDek,
      createdAt: Date.now(),
    });
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}
