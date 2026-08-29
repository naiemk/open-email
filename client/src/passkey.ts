import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, type Hex } from "viem";

export type Passkey = {
  secretKey: Uint8Array;
  qx: Hex;
  qy: Hex;
};

export type WebAuthnAuthJson = {
  r: Hex;
  s: Hex;
  challengeIndex: number;
  typeIndex: number;
  authenticatorData: Hex;
  clientDataJSON: string;
};

export function generatePasskey(): Passkey {
  const { secretKey } = p256.keygen();
  const uncompressed = p256.getPublicKey(secretKey, false);
  return {
    secretKey,
    qx: bytesToHex(uncompressed.slice(1, 33)),
    qy: bytesToHex(uncompressed.slice(33, 65)),
  };
}

export function signWebAuthn(challenge: Uint8Array, secretKey: Uint8Array): WebAuthnAuthJson {
  const authenticatorData = new Uint8Array(37);
  authenticatorData[32] = 0x05; // UP | UV
  const clientDataJSON = `{"type":"webauthn.get","challenge":"${Buffer.from(challenge).toString("base64url")}"}`;
  const clientHash = sha256(new TextEncoder().encode(clientDataJSON));
  const signed = new Uint8Array(authenticatorData.length + clientHash.length);
  signed.set(authenticatorData);
  signed.set(clientHash, authenticatorData.length);
  const messageHash = sha256(signed);
  const compact = p256.sign(messageHash, secretKey, { prehash: false, format: "compact" });
  return {
    r: bytesToHex(compact.slice(0, 32)),
    s: bytesToHex(compact.slice(32, 64)),
    challengeIndex: 23,
    typeIndex: 1,
    authenticatorData: bytesToHex(authenticatorData),
    clientDataJSON,
  };
}
