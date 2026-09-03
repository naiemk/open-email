import * as openpgp from "openpgp";
import { sha1 } from "@noble/hashes/legacy.js";
import { wrapDek, unwrapDek } from "./dek.ts";

/** z-base-32 alphabet (RFC 6189 / WKD). */
const ZBASE32 = "ybndrfg8ejkmcpqxot1uwisza345h769";

export function zbase32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ZBASE32[(value >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) out += ZBASE32[(value << (5 - bits)) & 31]!;
  return out;
}

/** WKD "hu" path segment for a mailbox local-part (lowercase). */
export function wkdHuHash(localPart: string): string {
  const normalized = localPart.trim().toLowerCase();
  return zbase32Encode(sha1(new TextEncoder().encode(normalized)));
}

export type OpenPgpIdentity = {
  publicArmored: string;
  privateArmored: string;
  email: string;
};

/** Generate a Curve25519 OpenPGP identity for SMTP E2EE (WKD / Proton). */
export async function generateOpenPgpIdentity(email: string): Promise<OpenPgpIdentity> {
  // Legacy Curve25519 (v4) for broad client support (Proton, etc.).
  // OpenPGP.js v6 renamed the curve to curve25519Legacy; type:'curve25519' is the newer format.
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: email.split("@")[0] || "user", email }],
    format: "armored",
  });
  return { publicArmored: publicKey, privateArmored: privateKey, email };
}

/** Wrap OpenPGP private key bytes with the DEK private (AES-GCM via wrapDek). */
export function wrapOpenPgpPrivate(privateArmored: string, dekPrivate: Uint8Array): Uint8Array {
  return wrapDek(new TextEncoder().encode(privateArmored), dekPrivate);
}

export function unwrapOpenPgpPrivate(wrapped: Uint8Array, dekPrivate: Uint8Array): string {
  return new TextDecoder().decode(unwrapDek(wrapped, dekPrivate));
}

export async function readOpenPgpPublic(armored: string): Promise<openpgp.PublicKey> {
  return openpgp.readKey({ armoredKey: armored });
}

export async function readOpenPgpPrivate(armored: string): Promise<openpgp.PrivateKey> {
  return openpgp.readPrivateKey({ armoredKey: armored });
}

/**
 * Parse a WKD response body (Proton often serves **binary** OpenPGP; some hosts armor).
 * Returns armored public key or undefined.
 */
export async function publicKeyFromWkdBytes(bytes: Uint8Array): Promise<string | undefined> {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 64));
  if (head.includes("BEGIN PGP PUBLIC KEY")) {
    const text = new TextDecoder().decode(bytes);
    await openpgp.readKey({ armoredKey: text });
    return text;
  }
  try {
    const key = await openpgp.readKey({ binaryKey: bytes });
    return key.armor();
  } catch {
    return undefined;
  }
}

/** Encrypt a UTF-8 MIME entity for an OpenPGP recipient; returns ASCII-armored ciphertext. */
export async function encryptForOpenPgp(
  plaintextMime: string,
  recipientPublicArmored: string,
): Promise<string> {
  const publicKey = await readOpenPgpPublic(recipientPublicArmored);
  const message = await openpgp.createMessage({ text: plaintextMime });
  const encrypted = await openpgp.encrypt({
    message,
    encryptionKeys: publicKey,
    format: "armored",
  });
  return String(encrypted);
}

/** Decrypt an OpenPGP binary or armored message to UTF-8 text. */
export async function decryptOpenPgp(
  ciphertext: Uint8Array | string,
  privateArmored: string,
): Promise<string> {
  const privateKey = await readOpenPgpPrivate(privateArmored);
  const message =
    typeof ciphertext === "string"
      ? await openpgp.readMessage({ armoredMessage: ciphertext })
      : await openpgp.readMessage({ binaryMessage: ciphertext });
  const { data } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
    format: "utf8",
  });
  return String(data);
}

export function looksLikeOpenPgpMessage(rfc822: string): boolean {
  if (/-----BEGIN PGP MESSAGE-----/.test(rfc822)) return true;
  if (/Content-Type:\s*multipart\/encrypted/i.test(rfc822)) return true;
  if (/protocol="?application\/pgp-encrypted"?/i.test(rfc822)) return true;
  return false;
}

/**
 * RFC 3156 PGP/MIME wrapper. `armoredCiphertext` is a full BEGIN/END PGP MESSAGE block.
 * Outer headers stay clear; only the MIME entity inside the ciphertext is confidential.
 */
export function wrapPgpMime(
  armoredCiphertext: string,
  from: string,
  to: string,
  subject: string,
): string {
  const boundary = `oe-pgp-${Date.now().toString(36)}`;
  const armor = armoredCiphertext.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n").trim() + "\r\n";
  const now = new Date();
  const messageId = `<${now.getTime().toString(36)}.${Math.random().toString(36).slice(2, 10)}@${from.split("@")[1] || "localhost"}>`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${now.toUTCString().replace(/GMT$/, "+0000")}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: application/pgp-encrypted",
    "",
    "Version: 1",
    "",
    `--${boundary}`,
    'Content-Type: application/octet-stream; name="encrypted.asc"',
    'Content-Disposition: inline; filename="encrypted.asc"',
    "Content-Transfer-Encoding: 7bit",
    "",
    armor,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Extract OpenPGP ciphertext bytes or armor from a PGP/MIME or inline armored RFC822. */
export async function extractOpenPgpCiphertext(rfc822: string): Promise<Uint8Array | string> {
  if (/-----BEGIN PGP MESSAGE-----/.test(rfc822)) {
    const start = rfc822.indexOf("-----BEGIN PGP MESSAGE-----");
    const end = rfc822.indexOf("-----END PGP MESSAGE-----");
    if (start >= 0 && end > start) {
      return rfc822.slice(start, end + "-----END PGP MESSAGE-----".length);
    }
  }
  const b64Match = rfc822.match(
    /Content-Type:\s*application\/octet-stream[\s\S]*?Content-Transfer-Encoding:\s*base64\r?\n\r?\n([\s\S]*?)(?:\r?\n--|\r?\n$)/i,
  );
  if (b64Match?.[1]) {
    const cleaned = b64Match[1].replace(/\s+/g, "");
    return base64ToBytes(cleaned);
  }
  throw new Error("OpenPGP ciphertext not found");
}
