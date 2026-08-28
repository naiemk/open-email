import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import * as raw from "multiformats/codecs/raw";

export type BlobStore = {
  pin: (bytes: Uint8Array) => Promise<string>;
  get: (cid: string) => Promise<Uint8Array | undefined>;
};

/** Tracer CAS: CIDv1 raw + sha2-256, pin-on-add (Kubo-shaped, in-process). */
export function createBlobStore(): BlobStore {
  const pins = new Map<string, Uint8Array>();
  return {
    async pin(bytes) {
      const hash = await sha256.digest(bytes);
      const cid = CID.createV1(raw.code, hash).toString();
      pins.set(cid, bytes);
      return cid;
    },
    async get(cid) {
      const bytes = pins.get(cid);
      return bytes ? new Uint8Array(bytes) : undefined;
    },
  };
}
