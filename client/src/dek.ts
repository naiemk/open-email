import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { x25519 } from "@noble/curves/ed25519.js";

const NONCE_LENGTH = 12;

export type Dek = {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
};

/** X25519 DEK. The private half is wrapped by a per-device KEK; never sent to a node. */
export function generateDek(): Dek {
  const pair = x25519.keygen();
  return { publicKey: pair.publicKey, privateKey: pair.secretKey };
}

/** AES-256-GCM wrap: `nonce || ciphertext||tag`. `kek` is 32 bytes from WebAuthn PRF. */
export function wrapDek(privateKey: Uint8Array, kek: Uint8Array): Uint8Array {
  const nonce = randomBytes(NONCE_LENGTH);
  const ciphertext = gcm(kek, nonce).encrypt(privateKey);
  const wrapped = new Uint8Array(nonce.length + ciphertext.length);
  wrapped.set(nonce);
  wrapped.set(ciphertext, nonce.length);
  return wrapped;
}

export function unwrapDek(wrapped: Uint8Array, kek: Uint8Array): Uint8Array {
  const nonce = wrapped.slice(0, NONCE_LENGTH);
  const ciphertext = wrapped.slice(NONCE_LENGTH);
  return gcm(kek, nonce).decrypt(ciphertext);
}
