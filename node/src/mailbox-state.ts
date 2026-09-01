import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type MailFlags = {
  read?: boolean;
  starred?: boolean;
  archived?: boolean;
  spam?: boolean;
  trashed?: boolean;
  labels?: string[];
  snoozeUntil?: number;
};

export type MailStateRow = MailFlags & { seq: number };

type StoredMailbox = Record<string, Record<string, MailFlags>>;

export type MailboxStateStore = {
  getFlags: (name: string, seq: number) => MailFlags;
  mergeRow: <T extends { seq: number; direction: "in" | "out" }>(
    name: string,
    row: T,
  ) => T & Required<Pick<MailFlags, "read" | "starred" | "archived" | "spam" | "trashed">> & {
    labels: string[];
    snoozeUntil?: number;
  };
  patch: (name: string, updates: Array<{ seq: number } & Partial<MailFlags>>) => void;
  trash: (name: string, seq: number) => void;
  restore: (name: string, seq: number) => void;
  trashedSeqs: (name: string) => number[];
  clearTrashFlags: (name: string, seqs: number[]) => void;
  listLabels: (name: string) => string[];
};

export function createMailboxStateStore(persistPath?: string): MailboxStateStore {
  const byName: StoredMailbox = {};
  if (persistPath && existsSync(persistPath)) {
    Object.assign(byName, JSON.parse(readFileSync(persistPath, "utf8")) as StoredMailbox);
  }
  const flush = () => {
    if (!persistPath) return;
    mkdirSync(dirname(persistPath), { recursive: true });
    writeFileSync(persistPath, JSON.stringify(byName));
  };
  const bucket = (name: string) => {
    if (!byName[name]) byName[name] = {};
    return byName[name]!;
  };
  const getFlags = (name: string, seq: number): MailFlags => bucket(name)[String(seq)] ?? {};
  const mergeRow = <T extends { seq: number; direction: "in" | "out" }>(name: string, row: T) => {
    const flags = getFlags(name, row.seq);
    const readDefault = row.direction === "out";
    return {
      ...row,
      read: flags.read ?? readDefault,
      starred: flags.starred ?? false,
      archived: flags.archived ?? false,
      spam: flags.spam ?? false,
      trashed: flags.trashed ?? false,
      labels: flags.labels ?? [],
      snoozeUntil: flags.snoozeUntil,
    };
  };
  const patchOne = (name: string, seq: number, patch: Partial<MailFlags>) => {
    const row = bucket(name);
    const prev = row[String(seq)] ?? {};
    const next: MailFlags = { ...prev, ...patch };
    if (patch.labels !== undefined) next.labels = [...patch.labels];
    if (
      !next.read &&
      !next.starred &&
      !next.archived &&
      !next.spam &&
      !next.trashed &&
      (!next.labels || next.labels.length === 0) &&
      next.snoozeUntil === undefined
    ) {
      delete row[String(seq)];
    } else {
      row[String(seq)] = next;
    }
  };
  return {
    getFlags,
    mergeRow,
    patch(name, updates) {
      for (const u of updates) {
        const { seq, ...patch } = u;
        patchOne(name, seq, patch);
      }
      flush();
    },
    trash(name, seq) {
      patchOne(name, seq, { trashed: true });
      flush();
    },
    restore(name, seq) {
      patchOne(name, seq, { trashed: false });
      flush();
    },
    trashedSeqs(name) {
      const rows = bucket(name);
      return Object.entries(rows)
        .filter(([, f]) => f.trashed)
        .map(([seq]) => Number(seq));
    },
    clearTrashFlags(name, seqs) {
      for (const seq of seqs) {
        const row = bucket(name)[String(seq)];
        if (!row) continue;
        delete row.trashed;
        if (
          !row.read &&
          !row.starred &&
          !row.archived &&
          !row.spam &&
          (!row.labels || row.labels.length === 0) &&
          row.snoozeUntil === undefined
        ) {
          delete bucket(name)[String(seq)];
        }
      }
      flush();
    },
    listLabels(name) {
      const labels = new Set<string>();
      for (const flags of Object.values(bucket(name))) {
        for (const label of flags.labels ?? []) labels.add(label);
      }
      return [...labels].sort();
    },
  };
}
