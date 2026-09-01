import { describe, expect, it } from "vitest";
import { hexToBytes } from "viem";
import { generatePasskey } from "./passkey.ts";
import { p256CoordsFromPublicKey, webAuthnUserError } from "./webauthn-p256.ts";

const SPKI_PREFIX = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce,
  0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

function encodeSpki(uncompressed: Uint8Array): Uint8Array {
  const out = new Uint8Array(SPKI_PREFIX.length + uncompressed.length);
  out.set(SPKI_PREFIX);
  out.set(uncompressed, SPKI_PREFIX.length);
  return out;
}

function uncompressedOf(qx: `0x${string}`, qy: `0x${string}`): Uint8Array {
  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(hexToBytes(qx), 1);
  point.set(hexToBytes(qy), 33);
  return point;
}

function lastIndexOfParser(spki: Uint8Array): void {
  const i = spki.lastIndexOf(0x04);
  if (i < 0 || i + 65 > spki.length) throw new Error("Passkey is not P-256");
}

function passkeyWith04InY(): ReturnType<typeof generatePasskey> {
  for (let n = 0; n < 400; n += 1) {
    const key = generatePasskey();
    if (hexToBytes(key.qy).includes(0x04)) return key;
  }
  throw new Error("could not mint a P-256 Y that contains 0x04");
}

describe("P-256 coords from a passkey public key", () => {
  it("reads a valid SPKI even when Y contains 0x04 (the lastIndexOf bug)", () => {
    const key = passkeyWith04InY();
    const spki = encodeSpki(uncompressedOf(key.qx, key.qy));
    expect(() => lastIndexOfParser(spki)).toThrow("Passkey is not P-256");
    expect(p256CoordsFromPublicKey(spki)).toEqual({ qx: key.qx, qy: key.qy });
  });

  it("reads coords from attestation COSE when getPublicKey is empty", () => {
    const key = generatePasskey();
    const attestation = encodeNoneAttestation(hexToBytes(key.qx), hexToBytes(key.qy));
    expect(p256CoordsFromPublicKey(new Uint8Array(0), attestation)).toEqual({ qx: key.qx, qy: key.qy });
  });
});

describe("WebAuthn user errors", () => {
  it("explains a pending ceremony instead of the raw InvalidStateError", () => {
    const err = Object.assign(new Error("A request is already pending."), { name: "InvalidStateError" });
    expect(webAuthnUserError(err)).toMatch(/already open/i);
  });

  it("maps AbortError to cancelled", () => {
    const err = Object.assign(new Error("Aborted"), { name: "AbortError" });
    expect(webAuthnUserError(err)).toMatch(/cancelled/i);
  });
});

function encodeNoneAttestation(x: Uint8Array, y: Uint8Array): Uint8Array {
  const cose = encodeCoseP256(x, y);
  const authData = new Uint8Array(55 + 16 + cose.length);
  authData[32] = 0x41; // UP | AT
  authData[54] = 16;
  authData.set(cose, 71);
  return encodeCborMap([
    ["fmt", "none"],
    ["attStmt", new Map()],
    ["authData", authData],
  ]);
}

function encodeCoseP256(x: Uint8Array, y: Uint8Array): Uint8Array {
  return encodeCborMap([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, x],
    [-3, y],
  ]);
}

function encodeCborMap(entries: [number | string, unknown][]): Uint8Array {
  const parts = [encodeHead(5, entries.length)];
  for (const [k, v] of entries) {
    parts.push(encodeCbor(k), encodeCbor(v));
  }
  return concat(parts);
}

function encodeCbor(value: unknown): Uint8Array {
  if (typeof value === "number") {
    if (value >= 0) return encodeHead(0, value);
    return encodeHead(1, -1 - value);
  }
  if (typeof value === "string") {
    const raw = new TextEncoder().encode(value);
    return concat([encodeHead(3, raw.length), raw]);
  }
  if (value instanceof Uint8Array) return concat([encodeHead(2, value.length), value]);
  if (value instanceof Map && value.size === 0) return encodeHead(5, 0);
  throw new Error("unsupported cbor fixture");
}

function encodeHead(major: number, n: number): Uint8Array {
  if (n < 24) return Uint8Array.of((major << 5) | n);
  if (n < 256) return Uint8Array.of((major << 5) | 24, n);
  return Uint8Array.of((major << 5) | 25, n >> 8, n & 0xff);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}
