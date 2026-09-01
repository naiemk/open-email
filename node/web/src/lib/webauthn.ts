import { bytesToHex, hexToBytes, type Hex } from "viem";
import { generateDek, unwrapDek, wrapDek } from "@client/dek.ts";
import { openEnvelope, sealEnvelope } from "@client/envelope.ts";
import { p256CoordsFromPublicKey, webAuthnUserError } from "@client/webauthn-p256.ts";
import * as mock from "@/lib/webauthn-mock";

export { webAuthnUserError, generateDek, unwrapDek, wrapDek, openEnvelope, sealEnvelope };

let mockMode = false;

/** Only one WebAuthn create/get at a time — browsers throw InvalidStateError otherwise. */
let ceremonyAbort: AbortController | null = null;

export function setMockPasskeyMode(on: boolean): void {
  mockMode = on || new URLSearchParams(location.search).has("mock");
}

export function isMockPasskeyMode(): boolean {
  return mockMode;
}

/** Cancel any in-flight passkey sheet (safe no-op if none). */
export function abortPasskeyCeremony(): void {
  ceremonyAbort?.abort();
  ceremonyAbort = null;
}

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
  if (mockMode) return mock.mockCreatePasskey(oeId, domain);
  return withCeremony(async (signal) => {
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
      signal,
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
  });
}

export async function connectPasskey(forCredentialId?: Hex): Promise<{ credentialId: Hex; kek: Uint8Array }> {
  if (mockMode) return mock.mockConnectPasskey(forCredentialId);
  return withCeremony(async (signal) => {
    const allowCredentials = forCredentialId
      ? [{ id: toBufferSource(hexToBytes(forCredentialId)), type: "public-key" as const }]
      : undefined;
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        userVerification: "required",
        allowCredentials,
        extensions: { prf: { eval: { first: PRF_SALT } } },
      },
      signal,
    })) as PublicKeyCredential | null;
    if (!cred) throw new Error("Passkey cancelled");
    const credentialId = bytesToHex(new Uint8Array(cred.rawId));
    if (forCredentialId && credentialId.toLowerCase() !== forCredentialId.toLowerCase()) {
      throw new Error("Wrong passkey selected");
    }
    return { credentialId, kek: prfFrom(cred) };
  });
}

export async function assertWebAuthn(
  challenge: Hex,
  credentialId?: Hex,
): Promise<{
  r: Hex;
  s: Hex;
  challengeIndex: number;
  typeIndex: number;
  authenticatorData: Hex;
  clientDataJSON: string;
}> {
  if (mockMode) return mock.mockAssertWebAuthn(challenge, credentialId);
  return withCeremony(async (signal) => {
    const allowCredentials = credentialId
      ? [{ id: toBufferSource(hexToBytes(credentialId)), type: "public-key" as const }]
      : undefined;
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge: toBufferSource(hexToBytes(challenge)),
        rpId: location.hostname,
        userVerification: "required",
        allowCredentials,
      },
      signal,
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
  });
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
  const dek = generateDek();
  return { publicKey: dek.publicKey, privateKey: dek.privateKey };
}

async function withCeremony<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  // Drop any prior sheet so a retry (or double-click) does not hit InvalidStateError.
  if (ceremonyAbort) {
    ceremonyAbort.abort();
    ceremonyAbort = null;
    await wait(50);
  }
  const ac = new AbortController();
  ceremonyAbort = ac;
  try {
    return await fn(ac.signal);
  } catch (err) {
    if (isPendingCeremonyError(err) && !ac.signal.aborted) {
      // Browser leftover from another tab/frame — clear and retry once.
      abortPasskeyCeremony();
      await wait(200);
      const retry = new AbortController();
      ceremonyAbort = retry;
      try {
        return await fn(retry.signal);
      } finally {
        if (ceremonyAbort === retry) ceremonyAbort = null;
      }
    }
    throw err;
  } finally {
    if (ceremonyAbort === ac) ceremonyAbort = null;
  }
}

function isPendingCeremonyError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  return name === "InvalidStateError" || /already pending/i.test(message);
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function prfFrom(cred: PublicKeyCredential): Uint8Array {
  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  const first = ext.prf?.results?.first;
  if (!first) throw new Error("Passkey PRF is required — use a device that supports PRF or enable mock mode");
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
