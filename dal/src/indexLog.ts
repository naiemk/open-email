import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes, type Hex } from "viem";

export type IndexEntry = {
  seq: number;
  name: string;
  time: number;
  cid: string;
  size: number;
  direction: "in" | "out";
  nodeKey: Hex;
  trashed: boolean;
};

export type IndexWrite = {
  name: string;
  time: number;
  cid: string;
  size: number;
  direction: "in" | "out";
  nodeKey: Hex;
  signature: Uint8Array;
};

export const STORAGE_CAP = 5 * 1024 * 1024;

export type MailIndex = {
  cap: number;
  append: (write: IndexWrite) => Promise<IndexEntry>;
  list: (name: string) => IndexEntry[];
  totalSize: (name: string) => number;
  trash: (name: string, seq: number) => void;
  emptyTrash: (name: string) => string[];
};

export function indexMessage(
  name: string,
  time: number,
  cid: string,
  size: number,
  direction: "in" | "out",
): Uint8Array {
  return new TextEncoder().encode(`${name}\n${time}\n${cid}\n${size}\n${direction}`);
}

export function signIndexWrite(
  secretKey: Uint8Array,
  name: string,
  time: number,
  cid: string,
  size: number,
  direction: "in" | "out",
): Uint8Array {
  return ed25519.sign(indexMessage(name, time, cid, size, direction), secretKey);
}

export function createMailIndex(opts: {
  isOptedIn: (name: string, nodeKey: Hex) => Promise<boolean>;
  cap?: number;
}): MailIndex {
  const cap = opts.cap ?? STORAGE_CAP;
  const entries: IndexEntry[] = [];
  let nextSeq = 1;
  return {
    cap,
    async append(write) {
      if (!(await opts.isOptedIn(write.name, write.nodeKey))) {
        throw new Error("unauthorized writer");
      }
      const ok = ed25519.verify(
        write.signature,
        indexMessage(write.name, write.time, write.cid, write.size, write.direction),
        hexToBytes(write.nodeKey),
      );
      if (!ok) throw new Error("bad index signature");
      const entry: IndexEntry = {
        seq: nextSeq++,
        name: write.name,
        time: write.time,
        cid: write.cid,
        size: write.size,
        direction: write.direction,
        nodeKey: write.nodeKey,
        trashed: false,
      };
      entries.push(entry);
      return entry;
    },
    list(name) {
      return entries.filter((e) => e.name === name);
    },
    totalSize(name) {
      return entries.filter((e) => e.name === name).reduce((sum, e) => sum + e.size, 0);
    },
    trash(name, seq) {
      const row = entries.find((e) => e.name === name && e.seq === seq);
      if (row) row.trashed = true;
    },
    emptyTrash(name) {
      const remaining = new Set(entries.filter((e) => !(e.name === name && e.trashed)).map((e) => e.cid));
      const dropped = entries.filter((e) => e.name === name && e.trashed && !remaining.has(e.cid));
      const cids = [...new Set(dropped.map((e) => e.cid))];
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i]!.name === name && entries[i]!.trashed) entries.splice(i, 1);
      }
      return cids;
    },
  };
}
