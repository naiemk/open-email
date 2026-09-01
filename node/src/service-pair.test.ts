import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "viem";
import { generateDek, wrapDek } from "../../client/src/dek.ts";
import { sealEnvelope, openEnvelope } from "../../client/src/envelope.ts";
import { encodeGrant, parseInvite, verifyInvite } from "../../client/src/pair-blob.ts";
import { generatePasskey, signWebAuthn } from "../../client/src/passkey.ts";
import { createMailIndex } from "../../dal/src/indexLog.ts";
import { createBlobStore } from "../../dal/src/storage.ts";
import {
  ANVIL_PRIVATE_KEY,
  ensureRegistryBuilt,
  isOptedIn,
  nameRecordOf,
  startAnvilStack,
  type AnvilStack,
} from "../../relayer/src/anvil.ts";
import {
  optInViaRelayer,
  optOutViaRelayer,
  registerNodeViaRelayer,
  registerViaRelayer,
  type RelayerSession,
} from "../../relayer/src/ops.ts";
import { startRelayer, type RunningRelayer } from "../../relayer/src/server.ts";
import { generateNodeServerKey } from "./keys.ts";
import { startNode, type RunningNode } from "./node.ts";
import { sendSmtp } from "./smtpSend.ts";

const rfc5322 = [
  "From: gmail-user@example.com",
  "To: alice@node-a.test",
  "Subject: service pair mail",
  "",
  "cross-node via signed invite blob",
  "",
].join("\r\n");

describe("cross-node service pair", () => {
  let stack: AnvilStack;
  let relayer: RunningRelayer;
  let nodeA: RunningNode;
  let nodeB: RunningNode;
  let session: RelayerSession;
  const keyA = generateNodeServerKey();
  const keyB = generateNodeServerKey();
  let blobs: ReturnType<typeof createBlobStore>;

  beforeAll(async () => {
    ensureRegistryBuilt();
    stack = await startAnvilStack();
    relayer = await startRelayer({
      rpcUrl: stack.rpcUrl,
      registry: stack.registry,
      privateKey: ANVIL_PRIVATE_KEY,
    });
    session = await registerViaRelayer(relayer.url, "alice");
    await registerNodeViaRelayer(relayer.url, "node-a.test", keyA.nodeKey);
    await registerNodeViaRelayer(relayer.url, "node-b.test", keyB.nodeKey);
    await optInViaRelayer(session, "alice", keyA.nodeKey);

    blobs = createBlobStore();
    const index = createMailIndex({
      isOptedIn: (name, nodeKey) => isOptedIn(stack, name, nodeKey),
    });
    const registry = {
      isOptedIn: (name: string, nodeKey: typeof keyA.nodeKey) => isOptedIn(stack, name, nodeKey),
      nameRecord: async (name: string) => {
        const [, , dekPublic, wrappedDek] = await nameRecordOf(stack, name);
        return { dekPublic, wrappedDek };
      },
    };
    nodeA = await startNode({
      domain: "node-a.test",
      nodeKey: keyA.nodeKey,
      nodeSecret: keyA.secretKey,
      blobs,
      index,
      registry,
      relayerUrl: relayer.url,
    });
    nodeB = await startNode({
      domain: "node-b.test",
      nodeKey: keyB.nodeKey,
      nodeSecret: keyB.secretKey,
      blobs,
      index,
      registry,
      relayerUrl: relayer.url,
    });
  });

  afterAll(async () => {
    await nodeA?.close();
    await nodeB?.close();
    await relayer?.close();
    await stack?.stop();
  });

  it("pairs alice onto B via signed invite and grant blobs only", async () => {
    expect(await isOptedIn(stack, "alice", keyB.nodeKey)).toBe(false);

    const guestPasskey = generatePasskey();
    const guestKek = new Uint8Array(32).fill(7);
    const transport = generateDek();
    const guestPub = bytesToHex(transport.publicKey);

    const signed = (await (
      await fetch(`${nodeB.url}/pair/invite-sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "alice",
          qx: guestPasskey.qx,
          qy: guestPasskey.qy,
          guestPub,
        }),
      })
    ).json()) as { blob: string };

    const invite = parseInvite(signed.blob);
    const nodeMeta = (await (await fetch(`${nodeA.url}/api/nodes/${invite.nodeKey}`)).json()) as {
      domain: string;
    };
    const usedBefore = (await (await fetch(`${nodeA.url}/api/invite-used/${invite.inviteId}`)).json()) as {
      used: boolean;
    };
    verifyInvite(invite, {
      registryDomain: nodeMeta.domain,
      inviteUsed: usedBefore.used,
      sessionName: "alice",
    });

    const sealed = await sealEnvelope(transport.publicKey, "alice", session.dek.privateKey);
    const challengeRes = await fetch(
      `${nodeA.url}/api/link-challenge?name=alice&nodeKey=${keyB.nodeKey}&newQx=${guestPasskey.qx}&newQy=${guestPasskey.qy}&inviteId=${invite.inviteId}`,
    );
    const { challenge } = (await challengeRes.json()) as { challenge: string };
    const auth = signWebAuthn(hexToBytes(challenge as `0x${string}`), session.passkey.secretKey);
    const grant = encodeGrant({
      v: 1,
      inviteId: invite.inviteId,
      name: "alice",
      nodeKey: keyB.nodeKey,
      qx: guestPasskey.qx,
      qy: guestPasskey.qy,
      sealedDek: bytesToHex(sealed),
      auth,
    });

    const linkRes = await fetch(`${nodeB.url}/api/link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "alice",
        nodeKey: keyB.nodeKey,
        newQx: guestPasskey.qx,
        newQy: guestPasskey.qy,
        inviteId: invite.inviteId,
        auth,
      }),
    });
    expect(linkRes.ok).toBe(true);
    expect(await isOptedIn(stack, "alice", keyB.nodeKey)).toBe(true);

    const dekPrivate = await openEnvelope(transport.privateKey, "alice", hexToBytes(bytesToHex(sealed)));
    const wrapped = bytesToHex(wrapDek(dekPrivate, guestKek));
    await fetch(`${nodeB.url}/pair/service-wrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "alice",
        credentialId: "0xguest",
        wrappedDek: wrapped,
      }),
    });

    const sent = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail-user@example.com",
      to: "alice@node-a.test",
      data: rfc5322,
    });
    expect(sent.dataCode).toBe(250);

    const rowsB = (await (await fetch(`${nodeB.url}/index/alice`)).json()) as { cid: string }[];
    expect(rowsB.length).toBeGreaterThan(0);
    const blob = new Uint8Array(await (await fetch(`${nodeB.url}/blobs/${rowsB[0]!.cid}?name=alice`)).arrayBuffer());
    const plaintext = new TextDecoder().decode(await openEnvelope(dekPrivate, "alice", blob));
    expect(plaintext).toContain("service pair mail");

    const optChallenge = (await (
      await fetch(`${nodeB.url}/api/opt-out-challenge?name=alice&nodeKey=${keyA.nodeKey}`)
    ).json()) as { challenge: string };
    const optAuth = signWebAuthn(hexToBytes(optChallenge.challenge as `0x${string}`), guestPasskey.secretKey);
    await fetch(`${nodeB.url}/api/opt-out`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alice", nodeKey: keyA.nodeKey, auth: optAuth }),
    });
    expect(await isOptedIn(stack, "alice", keyA.nodeKey)).toBe(false);

    const replayLink = await fetch(`${nodeB.url}/api/link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "alice",
        nodeKey: keyB.nodeKey,
        newQx: guestPasskey.qx,
        newQy: guestPasskey.qy,
        inviteId: invite.inviteId,
        auth,
      }),
    });
    expect(replayLink.ok).toBe(false);

    const usedAfter = (await (await fetch(`${nodeA.url}/api/invite-used/${invite.inviteId}`)).json()) as {
      used: boolean;
    };
    expect(usedAfter.used).toBe(true);
    expect(() =>
      verifyInvite(invite, {
        registryDomain: nodeMeta.domain,
        inviteUsed: usedAfter.used,
        sessionName: "alice",
      }),
    ).toThrow(/already used/i);

    void grant;
  });
});
