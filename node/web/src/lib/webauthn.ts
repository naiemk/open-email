import { bytesToHex, hexToBytes, type Hex } from "viem";
import { generateDek, unwrapDek, wrapDek } from "@client/dek.ts";
import { openEnvelope, sealEnvelope } from "@client/envelope.ts";
import { p256CoordsFromPublicKey, webAuthnUserError } from "@client/webauthn-p256.ts";
import { passkeyLog, passkeyLogError } from "@/lib/passkey-log";
import * as mock from "@/lib/webauthn-mock";

export { webAuthnUserError, generateDek, unwrapDek, wrapDek, openEnvelope, sealEnvelope };

let mockMode = false;

/** AbortController for logout / explicit cancel only — never abort between queued ceremonies. */
let ceremonyAbort: AbortController | null = null;
let ceremonyQueue: Promise<unknown> = Promise.resolve();
let ceremonySerial = 0;
let ceremonyQueueDepth = 0;

/** Tracks the live navigator.credentials promise; browsers reject new calls while this is pending. */
let activeBrowserCall: Promise<unknown> | null = null;

const BROWSER_SETTLE_MS = 1000;

export function setMockPasskeyMode(on: boolean): void {
  mockMode = on || new URLSearchParams(location.search).has("mock");
}

export function isMockPasskeyMode(): boolean {
  return mockMode;
}

/** Cancel any in-flight passkey sheet (safe no-op if none). */
export function abortPasskeyCeremony(): void {
  passkeyLog("abortPasskeyCeremony", {
    hadAbortController: !!ceremonyAbort,
    hadBrowserCall: !!activeBrowserCall,
  });
  ceremonyAbort?.abort();
  ceremonyAbort = null;
}

/** Wait until the browser WebAuthn slot is free (call before register after earlier ceremonies). */
export async function awaitPasskeyIdle(): Promise<void> {
  if (activeBrowserCall) {
    passkeyLog("awaitPasskeyIdle:wait-browser-call");
    await activeBrowserCall.catch(() => undefined);
  }
  await wait(BROWSER_SETTLE_MS);
  passkeyLog("awaitPasskeyIdle:ready", { hadBrowserCall: !!activeBrowserCall });
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
  return withCeremony("createPasskey", async (signal) => {
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const cred = await browserCreate("createPasskey", {
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: domain, id: location.hostname },
        user: { id: userId, name: oeId, displayName: oeId },
        pubKeyCredParams: [{ alg: -7, type: "public-key" }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        extensions: { prf: { eval: { first: PRF_SALT } } },
      },
      signal,
    });
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
    const credentialId = bytesToHex(new Uint8Array(cred.rawId));
    passkeyLog("createPasskey:done", { credentialId: credentialId.slice(0, 18) });
    return { credentialId, qx, qy, kek };
  });
}

export async function connectPasskey(forCredentialId?: Hex): Promise<{ credentialId: Hex; kek: Uint8Array }> {
  if (mockMode) return mock.mockConnectPasskey(forCredentialId);
  return withCeremony("connectPasskey", async (signal) => {
    const allowCredentials = forCredentialId
      ? [{ id: toBufferSource(hexToBytes(forCredentialId)), type: "public-key" as const }]
      : undefined;
    const cred = await browserGet("connectPasskey", {
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        userVerification: "required",
        allowCredentials,
        extensions: { prf: { eval: { first: PRF_SALT } } },
      },
      signal,
    });
    if (!cred) throw new Error("Passkey cancelled");
    const credentialId = bytesToHex(new Uint8Array(cred.rawId));
    if (forCredentialId && credentialId.toLowerCase() !== forCredentialId.toLowerCase()) {
      throw new Error("Wrong passkey selected");
    }
    passkeyLog("connectPasskey:done", { credentialId: credentialId.slice(0, 18) });
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
  return withCeremony("assertWebAuthn", async (signal) => {
    const allowCredentials = credentialId
      ? [{ id: toBufferSource(hexToBytes(credentialId)), type: "public-key" as const }]
      : undefined;
    const cred = await browserGet(
      "assertWebAuthn",
      {
        publicKey: {
          challenge: toBufferSource(hexToBytes(challenge)),
          rpId: location.hostname,
          userVerification: "required",
          allowCredentials,
        },
        signal,
      },
      { clearConditional: true },
    );
    if (!cred) throw new Error("Passkey assertion cancelled");
    const assertion = cred.response as AuthenticatorAssertionResponse;
    const clientDataJSON = new TextDecoder().decode(assertion.clientDataJSON);
    const { r, s } = parseEcdsaDer(new Uint8Array(assertion.signature));
    const { challengeIndex, typeIndex } = clientDataJsonIndices(clientDataJSON);
    passkeyLog("assertWebAuthn:done", {
      credentialId: bytesToHex(new Uint8Array(cred.rawId)).slice(0, 18),
      challengeIndex,
      typeIndex,
    });
    return {
      r: bytesToHex(r),
      s: bytesToHex(s),
      challengeIndex,
      typeIndex,
      authenticatorData: bytesToHex(new Uint8Array(assertion.authenticatorData)),
      clientDataJSON,
    };
  });
}

/** Indices for OpenZeppelin WebAuthn.verify — must point at `"type"` / `"challenge"` keys. */
export function clientDataJsonIndices(clientDataJSON: string): { challengeIndex: number; typeIndex: number } {
  const typeIndex = clientDataJSON.indexOf('"type"');
  const challengeIndex = clientDataJSON.indexOf('"challenge"');
  if (typeIndex < 0 || challengeIndex < 0) {
    passkeyLogError("clientDataJsonIndices:bad-json", new Error("missing fields"), {
      clientDataJSON: clientDataJSON.slice(0, 120),
    });
    throw new Error("Passkey returned invalid client data");
  }
  return { challengeIndex, typeIndex };
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

async function browserCreate(label: string, options: CredentialCreationOptions): Promise<PublicKeyCredential | null> {
  await awaitBrowserSlot(label);
  passkeyLog(`${label}:navigator.credentials.create`, { rpId: location.hostname });
  const call = navigator.credentials.create(options);
  activeBrowserCall = call;
  let failed = false;
  try {
    return (await call) as PublicKeyCredential | null;
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    if (activeBrowserCall === call) activeBrowserCall = null;
    passkeyLog(`${label}:navigator.credentials.create settled`, { failed });
    await wait(failed ? BROWSER_SETTLE_MS * 3 : BROWSER_SETTLE_MS);
  }
}

async function browserGet(
  label: string,
  options: CredentialRequestOptions,
  opts?: { clearConditional?: boolean },
): Promise<PublicKeyCredential | null> {
  await awaitBrowserSlot(label);
  if (opts?.clearConditional && typeof PublicKeyCredential.preventSilentAccess === "function") {
    passkeyLog(`${label}:preventSilentAccess`);
    await PublicKeyCredential.preventSilentAccess();
  }
  passkeyLog(`${label}:navigator.credentials.get`, {
    rpId: location.hostname,
    signalAborted: options.signal?.aborted ?? false,
  });
  const call = navigator.credentials.get(options);
  activeBrowserCall = call;
  let failed = false;
  try {
    const cred = (await call) as PublicKeyCredential | null;
    passkeyLog(`${label}:navigator.credentials.get returned`, { hasCred: !!cred });
    return cred;
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    if (activeBrowserCall === call) activeBrowserCall = null;
    passkeyLog(`${label}:navigator.credentials.get settled`, { failed });
    await wait(failed ? BROWSER_SETTLE_MS * 3 : BROWSER_SETTLE_MS);
  }
}

async function awaitBrowserSlot(label: string): Promise<void> {
  if (!activeBrowserCall) return;
  passkeyLog("awaitBrowserSlot:wait", { label });
  await activeBrowserCall.catch(() => undefined);
  await wait(BROWSER_SETTLE_MS);
  passkeyLog("awaitBrowserSlot:ready", { label });
}

async function withCeremony<T>(label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const cid = ++ceremonySerial;
  ceremonyQueueDepth += 1;
  passkeyLog("withCeremony:queued", { cid, label, queueDepth: ceremonyQueueDepth });

  const run = async (): Promise<T> => {
    passkeyLog("withCeremony:enter", { cid, label, activeBrowserCall: !!activeBrowserCall });
    const ac = new AbortController();
    ceremonyAbort = ac;
    passkeyLog("withCeremony:calling-fn", { cid, label });
    try {
      const result = await fn(ac.signal);
      passkeyLog("withCeremony:fn-ok", { cid, label });
      return result;
    } catch (err) {
      passkeyLogError("withCeremony:fn-error", err, { cid, label, signalAborted: ac.signal.aborted });
      throw err;
    } finally {
      if (ceremonyAbort === ac) ceremonyAbort = null;
      passkeyLog("withCeremony:exit", { cid, label, activeBrowserCall: !!activeBrowserCall });
      ceremonyQueueDepth -= 1;
    }
  };

  const ticket = ceremonyQueue.then(run, run);
  ceremonyQueue = ticket.catch(() => undefined);
  return ticket;
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
