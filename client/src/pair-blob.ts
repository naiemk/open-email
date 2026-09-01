import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes, type Hex } from "viem";
import type { WebAuthnAuthJson } from "./passkey.ts";

export type ServiceInvite = {
  v: 1;
  inviteId: Hex;
  name: string;
  domain: string;
  nodeKey: Hex;
  qx: Hex;
  qy: Hex;
  guestPub: Hex;
  exp: number;
  sig: Hex;
};

export type ServiceGrant = {
  v: 1;
  inviteId: Hex;
  name: string;
  nodeKey: Hex;
  qx: Hex;
  qy: Hex;
  sealedDek: Hex;
  auth: WebAuthnAuthJson;
};

export type InviteVerifyContext = {
  registryDomain: string;
  inviteUsed: boolean;
  sessionName: string;
  now?: number;
};

const INV_PREFIX = "oe-inv1.";
const GRANT_PREFIX = "oe-gr1.";

export function encodeInvite(invite: ServiceInvite): string {
  return INV_PREFIX + b64url(JSON.stringify(invite));
}

export function encodeGrant(grant: ServiceGrant): string {
  return GRANT_PREFIX + b64url(JSON.stringify(grant));
}

export function parseInvite(raw: string): ServiceInvite {
  const trimmed = raw.trim();
  const json = trimmed.startsWith(INV_PREFIX)
    ? trimmed.slice(INV_PREFIX.length)
    : trimmed.startsWith("{")
      ? trimmed
      : trimmed;
  const body = trimmed.startsWith(INV_PREFIX)
    ? JSON.parse(fromB64url(json)) as ServiceInvite
    : (JSON.parse(json) as ServiceInvite);
  if (body.v !== 1) throw new Error("Unsupported invite version");
  return body;
}

export function parseGrant(raw: string): ServiceGrant {
  const trimmed = raw.trim();
  const json = trimmed.startsWith(GRANT_PREFIX)
    ? trimmed.slice(GRANT_PREFIX.length)
    : trimmed.startsWith("{")
      ? trimmed
      : trimmed;
  const body = trimmed.startsWith(GRANT_PREFIX)
    ? JSON.parse(fromB64url(json)) as ServiceGrant
    : (JSON.parse(json) as ServiceGrant);
  if (body.v !== 1) throw new Error("Unsupported grant version");
  return body;
}

export function inviteSignPayload(invite: Omit<ServiceInvite, "sig">): Uint8Array {
  const canonical = stableJson({
    v: invite.v,
    inviteId: invite.inviteId,
    name: invite.name,
    domain: invite.domain,
    nodeKey: invite.nodeKey,
    qx: invite.qx,
    qy: invite.qy,
    guestPub: invite.guestPub,
    exp: invite.exp,
  });
  return new TextEncoder().encode(canonical);
}

export function signInvite(
  invite: Omit<ServiceInvite, "sig">,
  nodeSecret: Uint8Array,
): ServiceInvite {
  const sig = ed25519.sign(inviteSignPayload(invite), nodeSecret);
  return { ...invite, sig: bytesToHex(sig) };
}

export function verifyInvite(invite: ServiceInvite, ctx: InviteVerifyContext): void {
  if (!invite.sig || invite.sig === "0x") throw new Error("Invite is not signed");
  const now = ctx.now ?? Date.now();
  if (invite.exp <= now) throw new Error("Invite expired");
  if (ctx.inviteUsed) throw new Error("Invite already used");
  if (invite.name !== ctx.sessionName) throw new Error("Invite name does not match your mailbox");
  if (invite.domain !== ctx.registryDomain) throw new Error("Invite domain does not match registry");
  const { sig, ...rest } = invite;
  const ok = ed25519.verify(hexToBytes(sig), inviteSignPayload(rest), hexToBytes(invite.nodeKey));
  if (!ok) throw new Error("Invalid invite signature");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

function b64url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromB64url(text: string): string {
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  const bin = atob(text.replaceAll("-", "+").replaceAll("_", "/") + pad);
  return bin;
}

function bytesToHex(bytes: Uint8Array): Hex {
  return (`0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`) as Hex;
}
