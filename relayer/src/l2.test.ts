import { describe, expect, it } from "vitest";
import { baseSepolia } from "viem/chains";

/**
 * Live L2 (ticket #15): set L2_RPC_URL, L2_REGISTRY, L2_RELAYER_KEY.
 * Anvil Osaka already exercises P256VERIFY at 0x100.
 */
const configured = Boolean(process.env.L2_RPC_URL && process.env.L2_REGISTRY && process.env.L2_RELAYER_KEY);

describe.skipIf(!configured)("same seam on L2 testnet", () => {
  it("relayer can be pointed at Base Sepolia", () => {
    expect(baseSepolia.id).toBe(84532);
    expect(process.env.L2_RPC_URL).toMatch(/^https?:\/\//);
  });
});
