import { bytesToHex, hexToBytes, type Hex } from "viem";
import {
  decryptOpenPgp,
  encryptForOpenPgp,
  extractOpenPgpCiphertext,
  generateOpenPgpIdentity,
  looksLikeOpenPgpMessage,
  publicKeyFromWkdBytes,
  unwrapOpenPgpPrivate,
  wrapOpenPgpPrivate,
  wrapPgpMime,
  wkdHuHash,
} from "@client/openpgp-identity.ts";
import { smtpFrom } from "@/lib/mail";

export {
  looksLikeOpenPgpMessage,
  wrapPgpMime,
  encryptForOpenPgp,
  decryptOpenPgp,
  extractOpenPgpCiphertext,
  wkdHuHash,
  publicKeyFromWkdBytes,
};

export type StoredOpenPgp = {
  email: string;
  publicArmored: string;
  privateArmored: string;
};

/** Ensure mailbox has an OpenPGP identity published for WKD; returns private for session use. */
export async function ensureOpenPgpIdentity(
  name: string,
  domain: string,
  dekPrivate: Uint8Array,
): Promise<StoredOpenPgp> {
  const email = smtpFrom(domain, name).toLowerCase();
  const existing = await fetch(`/openpgp/${encodeURIComponent(name)}`);
  if (existing.ok) {
    const body = (await existing.json()) as {
      email: string;
      publicArmored: string;
      wrappedPrivateHex: Hex;
    };
    const privateArmored = unwrapOpenPgpPrivate(hexToBytes(body.wrappedPrivateHex), dekPrivate);
    return { email: body.email, publicArmored: body.publicArmored, privateArmored };
  }
  const id = await generateOpenPgpIdentity(email);
  const wrappedPrivateHex = bytesToHex(wrapOpenPgpPrivate(id.privateArmored, dekPrivate)) as Hex;
  const res = await fetch(`/openpgp/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      publicArmored: id.publicArmored,
      wrappedPrivateHex,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `OpenPGP publish failed (${res.status})`);
  }
  return { email, publicArmored: id.publicArmored, privateArmored: id.privateArmored };
}

/**
 * WKD lookup (direct + advanced). Returns armored public key or undefined.
 * @see https://datatracker.ietf.org/doc/draft-koch-openpgp-webkey-service/
 */
export async function lookupWkdPublicKey(email: string): Promise<string | undefined> {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return undefined;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const hu = wkdHuHash(local);
  const urls = [
    `https://openpgpkey.${domain}/.well-known/openpgpkey/${domain}/hu/${hu}?l=${encodeURIComponent(local)}`,
    `https://${domain}/.well-known/openpgpkey/${domain}/hu/${hu}?l=${encodeURIComponent(local)}`,
    `https://${domain}/.well-known/openpgpkey/hu/${hu}?l=${encodeURIComponent(local)}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const armored = await publicKeyFromWkdBytes(bytes);
      if (armored) return armored;
    } catch {
      // try next
    }
  }
  return undefined;
}

export async function decryptOpenPgpRfc822(
  rfc822: string,
  privateArmored: string,
): Promise<string> {
  const ct = await extractOpenPgpCiphertext(rfc822);
  return decryptOpenPgp(ct, privateArmored);
}
