import { describe, expect, it } from "vitest";
import { createMailIndex, normalizeIndexGeneration } from "./indexLog.ts";
import { signIndexWrite } from "./indexLog.ts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, type Hex } from "viem";

describe("index generation", () => {
  const nodeSecret = ed25519.utils.randomSecretKey();
  const nodeKeyHex = bytesToHex(ed25519.getPublicKey(nodeSecret)) as Hex;

  it("list and totalSize filter by generation", async () => {
    const index = createMailIndex({
      isOptedIn: async () => true,
    });
    const sign = (name: string, generation: number, time: number, cid: string, size: number) =>
      signIndexWrite(nodeSecret, name, generation, time, cid, size, "in");

    await index.append({
      name: "vitalik.eth",
      generation: 1,
      time: 1,
      cid: "cid-gen1",
      size: 100,
      direction: "in",
      nodeKey: nodeKeyHex,
      signature: sign("vitalik.eth", 1, 1, "cid-gen1", 100),
    });
    await index.append({
      name: "vitalik.eth",
      generation: 2,
      time: 2,
      cid: "cid-gen2",
      size: 50,
      direction: "in",
      nodeKey: nodeKeyHex,
      signature: sign("vitalik.eth", 2, 2, "cid-gen2", 50),
    });

    expect(index.list("vitalik.eth", 1)).toHaveLength(1);
    expect(index.list("vitalik.eth", 1)[0]?.cid).toBe("cid-gen1");
    expect(index.list("vitalik.eth", 2)).toHaveLength(1);
    expect(index.totalSize("vitalik.eth", 1)).toBe(100);
    expect(index.totalSize("vitalik.eth", 2)).toBe(50);
  });

  it("normalizeIndexGeneration treats 0 as legacy generation 1", () => {
    expect(normalizeIndexGeneration(0)).toBe(1);
    expect(normalizeIndexGeneration(1)).toBe(1);
    expect(normalizeIndexGeneration(2)).toBe(2);
  });
});
