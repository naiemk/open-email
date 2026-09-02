import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { generateNodeServerKey } from "../../node/src/keys.ts";
import {
  encodeGrant,
  encodeInvite,
  inviteSignPayload,
  parseGrant,
  parseInvite,
  signInvite,
  verifyInvite,
  type ServiceInvite,
} from "./pair-blob.ts";

describe("pair-blob", () => {
  const node = generateNodeServerKey();
  const base: Omit<ServiceInvite, "sig"> = {
    v: 1,
    inviteId: "0xabc123",
    name: "alice",
    domain: "node-b.test",
    nodeKey: node.nodeKey,
    qx: "0x1111",
    qy: "0x2222",
    guestPub: "0x3333",
    exp: Date.now() + 60_000,
  };

  it("round-trips invite and grant blobs", () => {
    const invite = signInvite(base, node.secretKey);
    const parsed = parseInvite(encodeInvite(invite));
    expect(parsed.inviteId).toBe(invite.inviteId);
    const grant = encodeGrant({
      v: 1,
      inviteId: invite.inviteId,
      name: invite.name,
      nodeKey: invite.nodeKey,
      qx: invite.qx,
      qy: invite.qy,
      sealedDek: "0xdead",
      auth: {
        r: "0x1",
        s: "0x2",
        challengeIndex: 23,
        typeIndex: 1,
        authenticatorData: "0x05",
        clientDataJSON: "{}",
      },
    });
    expect(parseGrant(grant).sealedDek).toBe("0xdead");
  });

  it("accepts a valid node signature", () => {
    const invite = signInvite(base, node.secretKey);
    verifyInvite(invite, {
      registryDomain: "node-b.test",
      inviteUsed: false,
      sessionName: "alice",
    });
  });

  it("rejects unsigned invite", () => {
    const bad = { ...base, sig: "0x" as const };
    expect(() =>
      verifyInvite(bad as ServiceInvite, {
        registryDomain: "node-b.test",
        inviteUsed: false,
        sessionName: "alice",
      }),
    ).toThrow(/not signed/i);
  });

  it("rejects wrong node key", () => {
    const other = generateNodeServerKey();
    const invite = signInvite(base, other.secretKey);
    expect(() =>
      verifyInvite(invite, {
        registryDomain: "node-b.test",
        inviteUsed: false,
        sessionName: "alice",
      }),
    ).toThrow(/Invalid invite signature/i);
  });

  it("rejects expired invite", () => {
    const invite = signInvite({ ...base, exp: Date.now() - 1 }, node.secretKey);
    expect(() =>
      verifyInvite(invite, {
        registryDomain: "node-b.test",
        inviteUsed: false,
        sessionName: "alice",
        now: Date.now(),
      }),
    ).toThrow(/expired/i);
  });

  it("rejects used invite id", () => {
    const invite = signInvite(base, node.secretKey);
    expect(() =>
      verifyInvite(invite, {
        registryDomain: "node-b.test",
        inviteUsed: true,
        sessionName: "alice",
      }),
    ).toThrow(/already used/i);
  });

  it("rejects wrong session name", () => {
    const invite = signInvite(base, node.secretKey);
    expect(() =>
      verifyInvite(invite, {
        registryDomain: "node-b.test",
        inviteUsed: false,
        sessionName: "bob",
      }),
    ).toThrow(/does not match/i);
  });

  it("rejects domain mismatch", () => {
    const invite = signInvite(base, node.secretKey);
    expect(() =>
      verifyInvite(invite, {
        registryDomain: "evil.test",
        inviteUsed: false,
        sessionName: "alice",
      }),
    ).toThrow(/domain does not match/i);
  });

  it("uses stable canonical bytes for signing", () => {
    const sig = ed25519.sign(inviteSignPayload(base), node.secretKey);
    expect(ed25519.verify(sig, inviteSignPayload(base), ed25519.getPublicKey(node.secretKey))).toBe(true);
  });
});
