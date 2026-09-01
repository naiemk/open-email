import { p256 } from "@noble/curves/nist.js";
import { bytesToHex, type Hex } from "viem";

export type P256Coords = { qx: Hex; qy: Hex };

export function p256CoordsFromPublicKey(spki: Uint8Array, attestationObject?: Uint8Array): P256Coords {
  if (spki.length) {
    try {
      return coordsFromPoint(pointFromSpkiOrRaw(spki));
    } catch {
      /* Safari sometimes hands back a buffer we cannot treat as SPKI; use attestation COSE. */
    }
  }
  if (attestationObject?.length) return coordsFromPoint(pointFromCose(coseFromAttestation(attestationObject)));
  throw new Error("Passkey is not P-256");
}

export function webAuthnUserError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  if (name === "AbortError") return "Passkey cancelled.";
  if (name === "InvalidStateError" || /already pending/i.test(message)) {
    return "A passkey prompt is already open. Finish or cancel it, then try again.";
  }
  if (name === "NotAllowedError") return "Passkey was cancelled.";
  return message;
}

function coordsFromPoint(point: Uint8Array): P256Coords {
  const uncompressed = p256.Point.fromBytes(point).toBytes(false);
  return { qx: bytesToHex(uncompressed.slice(1, 33)), qy: bytesToHex(uncompressed.slice(33, 65)) };
}

function pointFromSpkiOrRaw(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 65 && bytes[bytes.length - 65] === 0x04) return bytes.slice(bytes.length - 65);
  if (bytes.length >= 33) {
    const prefix = bytes[bytes.length - 33];
    if (prefix === 0x02 || prefix === 0x03) return bytes.slice(bytes.length - 33);
  }
  if (bytes.length === 64) {
    const out = new Uint8Array(65);
    out[0] = 0x04;
    out.set(bytes, 1);
    return out;
  }
  throw new Error("Passkey is not P-256");
}

function coseFromAttestation(attestationObject: Uint8Array): Uint8Array {
  const root = decodeCbor(attestationObject, { i: 0 });
  if (!(root instanceof Map)) throw new Error("Passkey is not P-256");
  const authData = root.get("authData");
  if (!(authData instanceof Uint8Array) || authData.length < 55) throw new Error("Passkey is not P-256");
  if ((authData[32]! & 0x40) === 0) throw new Error("Passkey is not P-256");
  const credIdLen = (authData[53]! << 8) | authData[54]!;
  const coseStart = 55 + credIdLen;
  if (coseStart >= authData.length) throw new Error("Passkey is not P-256");
  return authData.slice(coseStart);
}

function pointFromCose(cose: Uint8Array): Uint8Array {
  const map = decodeCbor(cose, { i: 0 });
  if (!(map instanceof Map)) throw new Error("Passkey is not P-256");
  const x = map.get(-2);
  const y = map.get(-3);
  if (!(x instanceof Uint8Array) || x.length !== 32 || !(y instanceof Uint8Array) || y.length !== 32) {
    throw new Error("Passkey is not P-256");
  }
  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(x, 1);
  point.set(y, 33);
  return point;
}

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor> | Cbor[];

function decodeCbor(data: Uint8Array, offset: { i: number }): Cbor {
  const lead = data[offset.i];
  if (lead == null) throw new Error("Passkey is not P-256");
  const major = lead >> 5;
  const addl = lead & 31;
  offset.i += 1;
  const n = readCborLen(data, offset, addl);
  if (major === 0) return n;
  if (major === 1) return -1 - n;
  if (major === 2) {
    const slice = data.slice(offset.i, offset.i + n);
    offset.i += n;
    return slice;
  }
  if (major === 3) {
    const text = new TextDecoder().decode(data.slice(offset.i, offset.i + n));
    offset.i += n;
    return text;
  }
  if (major === 4) {
    const list: Cbor[] = [];
    for (let i = 0; i < n; i += 1) list.push(decodeCbor(data, offset));
    return list;
  }
  if (major === 5) {
    const map = new Map<Cbor, Cbor>();
    for (let i = 0; i < n; i += 1) map.set(decodeCbor(data, offset), decodeCbor(data, offset));
    return map;
  }
  throw new Error("Passkey is not P-256");
}

function readCborLen(data: Uint8Array, offset: { i: number }, addl: number): number {
  if (addl < 24) return addl;
  if (addl === 24) {
    const n = data[offset.i];
    if (n == null) throw new Error("Passkey is not P-256");
    offset.i += 1;
    return n;
  }
  if (addl === 25) {
    const hi = data[offset.i];
    const lo = data[offset.i + 1];
    if (hi == null || lo == null) throw new Error("Passkey is not P-256");
    offset.i += 2;
    return (hi << 8) | lo;
  }
  throw new Error("Passkey is not P-256");
}
