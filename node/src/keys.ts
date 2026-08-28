import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, type Hex } from "viem";

export function generateNodeServerKey(): { secretKey: Uint8Array; nodeKey: Hex } {
  const { secretKey, publicKey } = ed25519.keygen();
  return { secretKey, nodeKey: bytesToHex(publicKey) };
}
