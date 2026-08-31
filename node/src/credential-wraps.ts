import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Hex } from "viem";

export type CredentialWrap = {
  name: string;
  wrappedDek: Hex;
  credentialId: Hex;
  createdAt: number;
};

export type CredentialWrapStore = {
  get: (credentialId: string) => CredentialWrap | undefined;
  set: (wrap: CredentialWrap) => void;
  listForName: (name: string) => CredentialWrap[];
};

export function createCredentialWrapStore(persistPath?: string): CredentialWrapStore {
  const byCred = new Map<string, CredentialWrap>();
  if (persistPath && existsSync(persistPath)) {
    const raw = JSON.parse(readFileSync(persistPath, "utf8")) as CredentialWrap[];
    for (const row of raw) byCred.set(row.credentialId.toLowerCase(), row);
  }
  const flush = () => {
    if (!persistPath) return;
    mkdirSync(dirname(persistPath), { recursive: true });
    writeFileSync(persistPath, JSON.stringify([...byCred.values()], null, 0));
  };
  return {
    get(credentialId) {
      return byCred.get(credentialId.toLowerCase());
    },
    set(wrap) {
      byCred.set(wrap.credentialId.toLowerCase(), wrap);
      flush();
    },
    listForName(name) {
      return [...byCred.values()].filter((w) => w.name === name);
    },
  };
}
