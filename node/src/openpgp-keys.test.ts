import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { wkdHuHash } from "../../client/src/openpgp-identity.ts";
import { createOpenPgpKeyStore } from "./openpgp-keys.ts";

const sample = {
  name: "alice",
  email: "alice@example.com",
  publicArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----\ntest\n-----END PGP PUBLIC KEY BLOCK-----",
  wrappedPrivateHex: "0xdeadbeef" as const,
};

describe("createOpenPgpKeyStore", () => {
  it("set computes hu from email local-part via wkdHuHash and getByHu finds it", () => {
    const store = createOpenPgpKeyStore();
    const record = store.set(sample);
    const expectedHu = wkdHuHash("alice").toLowerCase();
    expect(record.hu).toBe(expectedHu);
    expect(store.getByHu(expectedHu)).toEqual(record);
    expect(store.getByName("Alice")).toEqual(record);
  });

  it("getByHu is case-insensitive on the lookup hu", () => {
    const store = createOpenPgpKeyStore();
    const record = store.set(sample);
    expect(store.getByHu(record.hu.toUpperCase())).toEqual(record);
  });

  it("set accepts explicit hu and persists across reload", () => {
    const dir = mkdtempSync(join(tmpdir(), "openpgp-keys-"));
    const path = join(dir, "keys.json");
    try {
      const customHu = "customhu123";
      const store1 = createOpenPgpKeyStore(path);
      store1.set({ ...sample, hu: customHu });
      const store2 = createOpenPgpKeyStore(path);
      expect(store2.getByHu(customHu)).toMatchObject({ name: "alice", hu: customHu });
      const raw = JSON.parse(readFileSync(path, "utf8")) as { hu: string }[];
      expect(raw[0]?.hu).toBe(customHu);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
