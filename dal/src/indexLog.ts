import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes, type Hex } from "viem";

export type IndexEntry = {
  seq: number;
  name: string;
  time: number;
  cid: string;
  nodeKey: Hex;
};

export type IndexWrite = {
  name: string;
  time: number;
  cid: string;
  nodeKey: Hex;
  signature: Uint8Array;
};

export type MailIndex = {
  append: (write: IndexWrite) => Promise<IndexEntry>;
  list: (name: string) => IndexEntry[];
};

export function indexMessage(name: string, time: number, cid: string): Uint8Array {
  return new TextEncoder().encode(`${name}\n${time}\n${cid}`);
}

export function signIndexWrite(secretKey: Uint8Array, name: string, time: number, cid: string): Uint8Array {
  return ed25519.sign(indexMessage(name, time, cid), secretKey);
}

export function createMailIndex(opts: {
  isOptedIn: (name: string, nodeKey: Hex) => Promise<boolean>;
}): MailIndex {
  const entries: IndexEntry[] = [];
  let nextSeq = 1;
  return {
    async append(write) {
      if (!(await opts.isOptedIn(write.name, write.nodeKey))) {
        throw new Error("unauthorized writer");
      }
      const ok = ed25519.verify(
        write.signature,
        indexMessage(write.name, write.time, write.cid),
        hexToBytes(write.nodeKey),
      );
      if (!ok) throw new Error("bad index signature");
      const entry: IndexEntry = {
        seq: nextSeq++,
        name: write.name,
        time: write.time,
        cid: write.cid,
        nodeKey: write.nodeKey,
      };
      entries.push(entry);
      return entry;
    },
    list(name) {
      return entries.filter((e) => e.name === name);
    },
  };
}
