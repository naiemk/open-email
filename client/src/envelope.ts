import {
  Aes128Gcm,
  CipherSuite,
  DhkemX25519HkdfSha256,
  HkdfSha256,
} from "@hpke/core";

const ENC_LENGTH = 32;

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes128Gcm(),
});

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** HPKE Base, DHKEM(X25519, HKDF-SHA256)+HKDF-SHA256+AES-128-GCM. Blob is `enc || ct`. `info` is the name. */
export async function sealEnvelope(dekPublic: Uint8Array, name: string, plaintext: Uint8Array): Promise<Uint8Array> {
  const recipientPublicKey = await suite.kem.deserializePublicKey(toBuffer(dekPublic));
  const { enc, ct } = await suite.seal(
    { recipientPublicKey, info: toBuffer(new TextEncoder().encode(name)) },
    toBuffer(plaintext),
  );
  const blob = new Uint8Array(enc.byteLength + ct.byteLength);
  blob.set(new Uint8Array(enc));
  blob.set(new Uint8Array(ct), enc.byteLength);
  return blob;
}

export async function openEnvelope(dekPrivate: Uint8Array, name: string, blob: Uint8Array): Promise<Uint8Array> {
  const enc = toBuffer(blob.slice(0, ENC_LENGTH));
  const ct = toBuffer(blob.slice(ENC_LENGTH));
  const recipientKey = await suite.kem.deserializePrivateKey(toBuffer(dekPrivate));
  const pt = await suite.open({ recipientKey, enc, info: toBuffer(new TextEncoder().encode(name)) }, ct);
  return new Uint8Array(pt);
}
