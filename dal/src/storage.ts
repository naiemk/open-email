import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import * as raw from "multiformats/codecs/raw";

export type BlobStore = {
  pin: (bytes: Uint8Array) => Promise<string>;
  get: (cid: string) => Promise<Uint8Array | undefined>;
  unpin: (cid: string) => void;
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
    unpin(cid) {
      pins.delete(cid);
    },
  };
}

/** Local-disk CAS for the VPS **DAL**. CID filenames are content-addressed (no `/`). */
export function createDiskBlobStore(dir: string): BlobStore {
  mkdirSync(dir, { recursive: true });
  return {
    async pin(bytes) {
      const hash = await sha256.digest(bytes);
      const cid = CID.createV1(raw.code, hash).toString();
      writeFileSync(join(dir, cid), bytes);
      return cid;
    },
    async get(cid) {
      if (cid.includes("/") || cid.includes("\\") || cid.includes("..")) return undefined;
      const path = join(dir, cid);
      if (!existsSync(path)) return undefined;
      return new Uint8Array(readFileSync(path));
    },
    unpin(cid) {
      if (cid.includes("/") || cid.includes("\\") || cid.includes("..")) return;
      const path = join(dir, cid);
      if (existsSync(path)) unlinkSync(path);
    },
  };
}
