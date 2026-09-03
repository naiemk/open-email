import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { wkdHuHash } from "../../client/src/openpgp-identity.ts";

export type OpenPgpKeyRecord = {
  name: string;
  email: string;
  publicArmored: string;
  wrappedPrivateHex: Hex;
  hu: string;
  updatedAt: number;
};

export type OpenPgpKeyStore = {
  getByName: (name: string) => OpenPgpKeyRecord | undefined;
  getByHu: (hu: string) => OpenPgpKeyRecord | undefined;
  set: (record: Omit<OpenPgpKeyRecord, "hu" | "updatedAt"> & { hu?: string }) => OpenPgpKeyRecord;
};

export function createOpenPgpKeyStore(persistPath?: string): OpenPgpKeyStore {
  const byName = new Map<string, OpenPgpKeyRecord>();
  if (persistPath && existsSync(persistPath)) {
    const raw = JSON.parse(readFileSync(persistPath, "utf8")) as OpenPgpKeyRecord[];
    for (const row of raw) byName.set(row.name.toLowerCase(), row);
  }
  const flush = () => {
    if (!persistPath) return;
    mkdirSync(dirname(persistPath), { recursive: true });
    writeFileSync(persistPath, JSON.stringify([...byName.values()], null, 0));
  };
  return {
    getByName(name) {
      return byName.get(name.toLowerCase());
    },
    getByHu(hu) {
      const needle = hu.toLowerCase();
      return [...byName.values()].find((r) => r.hu === needle);
    },
    set(input) {
      const local = input.email.split("@")[0] ?? input.name;
      const record: OpenPgpKeyRecord = {
        name: input.name,
        email: input.email,
        publicArmored: input.publicArmored,
        wrappedPrivateHex: input.wrappedPrivateHex,
        hu: (input.hu ?? wkdHuHash(local)).toLowerCase(),
        updatedAt: Date.now(),
      };
      byName.set(record.name.toLowerCase(), record);
      flush();
      return record;
    },
  };
}

export function wrappedPrivateBytes(record: OpenPgpKeyRecord): Uint8Array {
  return hexToBytes(record.wrappedPrivateHex);
}

export function toWrappedPrivateHex(bytes: Uint8Array): Hex {
  return bytesToHex(bytes);
}
