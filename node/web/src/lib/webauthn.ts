import { bytesToHex, hexToBytes, type Hex } from "viem";
import { generateDek, unwrapDek, wrapDek } from "@client/dek.ts";
import { openEnvelope, sealEnvelope } from "@client/envelope.ts";
import { p256CoordsFromPublicKey, webAuthnUserError } from "@client/webauthn-p256.ts";

export { webAuthnUserError, generateDek, unwrapDek, wrapDek, openEnvelope, sealEnvelope };

const PRF_SALT = new Uint8Array(32);
new TextEncoder().encode("open-email/prf-kek/v1").forEach((b, i) => {
  PRF_SALT[i] = b;
});

export type PasskeyMaterial = {
  credentialId: Hex;
  qx: Hex;
  qy: Hex;
  kek: Uint8Array;
};

export function registryName(oeId: string, domain: string): string {
  const id = oeId.trim();
  return domain === "testnet.crypted.email" ? `${id}.testnet` : id;
}

export function isValidOeId(oeId: string): boolean {
  const id = oeId.trim();
  return id.length >= 5 && !id.includes(".");
}

export async function createPasskey(oeId: string, domain: string): Promise<PasskeyMaterial> {
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: domain, id: location.hostname },
      user: { id: userId, name: oeId, displayName: oeId },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      extensions: { prf: { eval: { first: PRF_SALT } } },
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey was not created");
  const att = cred.response as AuthenticatorAttestationResponse;
  let spki = new Uint8Array(0);
  try {
    spki = new Uint8Array(att.getPublicKey?.() ?? new ArrayBuffer(0));
  } catch {
    /* Safari may omit getPublicKey */
  }
  const { qx, qy } = p256CoordsFromPublicKey(spki, new Uint8Array(att.attestationObject));
  const kek = prfFrom(cred);
  return { credentialId: bytesToHex(new Uint8Array(cred.rawId)), qx, qy, kek };
}

export async function connectPasskey(): Promise<{ credentialId: Hex; kek: Uint8Array }> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      userVerification: "required",
      extensions: { prf: { eval: { first: PRF_SALT } } },
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey cancelled");
  return { credentialId: bytesToHex(new Uint8Array(cred.rawId)), kek: prfFrom(cred) };
}

export async function assertWebAuthn(challenge: Hex): Promise<{
  r: Hex;
  s: Hex;
  challengeIndex: number;
  typeIndex: number;
  authenticatorData: Hex;
  clientDataJSON: string;
}> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: toBufferSource(hexToBytes(challenge)),
      rpId: location.hostname,
      userVerification: "required",
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey assertion cancelled");
  const assertion = cred.response as AuthenticatorAssertionResponse;
  const clientDataJSON = new TextDecoder().decode(assertion.clientDataJSON);
  const { r, s } = parseEcdsaDer(new Uint8Array(assertion.signature));
  return {
    r: bytesToHex(r),
    s: bytesToHex(s),
    challengeIndex: clientDataJSON.indexOf('"challenge"'),
    typeIndex: clientDataJSON.indexOf('"type"'),
    authenticatorData: bytesToHex(new Uint8Array(assertion.authenticatorData)),
    clientDataJSON,
  };
}

export function encodeRecovery(kek: Uint8Array, wrap: Uint8Array): string {
  const packed = new Uint8Array(kek.length + wrap.length);
  packed.set(kek);
  packed.set(wrap, kek.length);
  let bin = "";
  packed.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return `oe-r1.${btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")}`;
}

export function generateTransportKeypair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  /* X25519 for HPKE transport during pairing — use generateDek pattern */
  const dek = generateDek();
  return { publicKey: dek.publicKey, privateKey: dek.privateKey };
}

function prfFrom(cred: PublicKeyCredential): Uint8Array {
  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  const first = ext.prf?.results?.first;
  if (!first) throw new Error("Passkey PRF is required");
  const kek = new Uint8Array(first);
  if (kek.length !== 32) throw new Error("PRF KEK must be 32 bytes");
  return kek;
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function parseEcdsaDer(sig: Uint8Array): { r: Uint8Array; s: Uint8Array } {
  let o = 2;
  if (sig[0] !== 0x30) throw new Error("bad assertion signature");
  if (sig[2] !== 0x02) throw new Error("bad assertion signature");
  const rLen = sig[3]!;
  const r = pad32(stripInt(sig.slice(4, 4 + rLen)));
  o = 4 + rLen;
  if (sig[o] !== 0x02) throw new Error("bad assertion signature");
  const sLen = sig[o + 1]!;
  const s = pad32(stripInt(sig.slice(o + 2, o + 2 + sLen)));
  return { r, s };
}

function stripInt(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i += 1;
  return bytes.slice(i);
}

function pad32(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}
