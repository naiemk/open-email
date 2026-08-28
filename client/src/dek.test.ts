import { describe, expect, it } from "vitest";
import { generateDek, unwrapDek, wrapDek } from "./dek.ts";

describe("DEK wrap", () => {
  it("wraps the X25519 private half with a KEK so unwrap recovers the same key", () => {
    const dek = generateDek();
    const kek = new Uint8Array(32).fill(7);

    const wrapped = wrapDek(dek.privateKey, kek);

    expect(dek.publicKey.byteLength).toBe(32);
    expect(dek.privateKey.byteLength).toBe(32);
    expect(wrapped).not.toEqual(dek.privateKey);
    expect(unwrapDek(wrapped, kek)).toEqual(dek.privateKey);
  });

  it("does not unwrap with a different KEK", () => {
    const dek = generateDek();
    const wrapped = wrapDek(dek.privateKey, new Uint8Array(32).fill(7));

    expect(() => unwrapDek(wrapped, new Uint8Array(32).fill(8))).toThrow();
  });
});
