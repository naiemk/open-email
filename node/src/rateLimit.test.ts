import { describe, expect, it } from "vitest";
import { createHitWindow } from "./rateLimit.ts";
import { smtpFromAddress } from "./send.ts";

describe("send helpers", () => {
  it("maps a testnet registry name to {oe-id}@testnet.crypted.email", () => {
    expect(smtpFromAddress("testnet.crypted.email", "alice.testnet")).toBe("alice@testnet.crypted.email");
    expect(smtpFromAddress("node-a.test", "alice")).toBe("alice@node-a.test");
  });

  it("enforces 100/day send and 6/day opt windows", () => {
    const send = createHitWindow();
    const now = 1_000;
    for (let i = 0; i < 100; i++) expect(send.take("alice", now, 1000, 100)).toBe(true);
    expect(send.take("alice", now, 1000, 100)).toBe(false);
    const opt = createHitWindow();
    for (let i = 0; i < 6; i++) expect(opt.take("alice", now, 100, 6)).toBe(true);
    expect(opt.take("alice", now, 100, 6)).toBe(false);
  });
});
