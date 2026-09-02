import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes, type Hex } from "viem";

export type IndexEntry = {
  seq: number;
  name: string;
  generation: number;
  time: number;
  cid: string;
  size: number;
  direction: "in" | "out";
  nodeKey: Hex;
};

export type IndexWrite = {
  name: string;
  generation: number;
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
  list: (name: string, generation: number) => IndexEntry[];
  totalSize: (name: string, generation: number) => number;
  remove: (name: string, seqs: number[]) => string[];
};

export function indexMessage(
  name: string,
  generation: number,
  time: number,
  cid: string,
  size: number,
  direction: "in" | "out",
): Uint8Array {
  return new TextEncoder().encode(`${name}\n${generation}\n${time}\n${cid}\n${size}\n${direction}`);
}

export function signIndexWrite(
  secretKey: Uint8Array,
  name: string,
  generation: number,
  time: number,
  cid: string,
  size: number,
  direction: "in" | "out",
): Uint8Array {
  return ed25519.sign(indexMessage(name, generation, time, cid, size, direction), secretKey);
}

export function createMailIndex(opts: {
  isOptedIn: (name: string, nodeKey: Hex) => Promise<boolean>;
  cap?: number;
  persistPath?: string;
}): MailIndex {
  const cap = opts.cap ?? STORAGE_CAP;
  const entries: IndexEntry[] = [];
  let nextSeq = 1;
  if (opts.persistPath && existsSync(opts.persistPath)) {
    const snap = JSON.parse(readFileSync(opts.persistPath, "utf8")) as {
      entries: Array<IndexEntry & { generation?: number }>;
      nextSeq: number;
    };
    for (const row of snap.entries ?? []) {
      entries.push({ ...row, generation: row.generation ?? 1 });
    }
    nextSeq = snap.nextSeq ?? entries.length + 1;
  }
  const save = () => {
    if (!opts.persistPath) return;
    mkdirSync(dirname(opts.persistPath), { recursive: true });
    writeFileSync(opts.persistPath, JSON.stringify({ entries, nextSeq }));
  };
  return {
    cap,
    async append(write) {
      if (!(await opts.isOptedIn(write.name, write.nodeKey))) {
        throw new Error("unauthorized writer");
      }
      const ok = ed25519.verify(
        write.signature,
        indexMessage(write.name, write.generation, write.time, write.cid, write.size, write.direction),
        hexToBytes(write.nodeKey),
      );
      if (!ok) throw new Error("bad index signature");
      const entry: IndexEntry = {
        seq: nextSeq++,
        name: write.name,
        generation: write.generation,
        time: write.time,
        cid: write.cid,
        size: write.size,
        direction: write.direction,
        nodeKey: write.nodeKey,
      };
      entries.push(entry);
      save();
      return entry;
    },
    list(name, generation) {
      return entries.filter((e) => e.name === name && e.generation === generation);
    },
    totalSize(name, generation) {
      return entries
        .filter((e) => e.name === name && e.generation === generation)
        .reduce((sum, e) => sum + e.size, 0);
    },
    remove(name, seqs) {
      const drop = new Set(seqs);
      const remaining = new Set(
        entries.filter((e) => !(e.name === name && drop.has(e.seq))).map((e) => e.cid),
      );
      const cids = [
        ...new Set(
          entries.filter((e) => e.name === name && drop.has(e.seq) && !remaining.has(e.cid)).map((e) => e.cid),
        ),
      ];
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i]!.name === name && drop.has(entries[i]!.seq)) entries.splice(i, 1);
      }
      save();
      return cids;
    },
  };
}
