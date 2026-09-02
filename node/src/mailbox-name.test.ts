import { describe, expect, it } from "vitest";
import { isLinkedEnsName, mailboxName } from "./mailbox-name.ts";

describe("mailboxName", () => {
  it("maps OE id on testnet domain", () => {
    expect(mailboxName("testnet.crypted.email", "alice@testnet.crypted.email")).toBe("alice.testnet");
  });

  it("maps linked ENS on testnet domain", () => {
    expect(mailboxName("testnet.crypted.email", "vitalik.eth@testnet.crypted.email")).toBe("vitalik.eth");
  });

  it("rejects dotted non-ens local-parts on testnet", () => {
    expect(mailboxName("testnet.crypted.email", "alice.testnet@testnet.crypted.email")).toBeUndefined();
  });

  it("passes through names on production domain", () => {
    expect(mailboxName("crypted.email", "vitalik.eth@crypted.email")).toBe("vitalik.eth");
  });
});

describe("isLinkedEnsName", () => {
  it("accepts eth 2lds only", () => {
    expect(isLinkedEnsName("vitalik.eth")).toBe(true);
    expect(isLinkedEnsName("alice.testnet")).toBe(false);
    expect(isLinkedEnsName("foo.bar.eth")).toBe(false);
  });
});
