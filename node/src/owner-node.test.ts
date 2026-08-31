import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hexToBytes, keccak256, toBytes } from "viem";
import { unwrapDek } from "../../client/src/dek.ts";
import { signWebAuthn } from "../../client/src/passkey.ts";
import { openEnvelope } from "../../client/src/envelope.ts";
import { createMailIndex } from "../../dal/src/indexLog.ts";
import { createBlobStore } from "../../dal/src/storage.ts";
import {
  ANVIL_ACCOUNT_1,
  ANVIL_PRIVATE_KEY,
  ensureRegistryBuilt,
  isOptedIn,
  nameRecordOf,
  nodeOf,
  startAnvilStack,
  type AnvilStack,
} from "../../relayer/src/anvil.ts";
import { optInViaRelayer, registerViaRelayer, type RelayerSession } from "../../relayer/src/ops.ts";
import { startRelayer, type RunningRelayer } from "../../relayer/src/server.ts";
import { generateNodeServerKey } from "./keys.ts";
import { startNode, type RunningNode } from "./node.ts";
import { sendSmtp } from "./smtpSend.ts";

const name = "alice.testnet";
const oeId = "alice";
const domain = "testnet.crypted.email";
const rfc5322 = [
  "From: gmail-user@example.com",
  `To: ${oeId}@${domain}`,
  "Subject: owner-registered receive",
  "",
  "hello after owner registration",
  "",
].join("\r\n");

describe("owner-registered node through receive", () => {
  let stack: AnvilStack;
  let relayer: RunningRelayer;
  let nodeA: RunningNode;
  let session: RelayerSession;
  const server = generateNodeServerKey();

  beforeAll(async () => {
    ensureRegistryBuilt();
    stack = await startAnvilStack({ testnetMode: true });
    relayer = await startRelayer({
      rpcUrl: stack.rpcUrl,
      registry: stack.registry,
      privateKey: ANVIL_PRIVATE_KEY,
    });
  });

  afterAll(async () => {
    await nodeA?.close();
    await relayer?.close();
    await stack?.stop();
  });

  it("rejects registerNode from a relayer that is not the registry owner", async () => {
    const stranger = await startRelayer({
      rpcUrl: stack.rpcUrl,
      registry: stack.registry,
      privateKey: ANVIL_ACCOUNT_1,
    });
    try {
      const denied = await fetch(`${stranger.url}/nodes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain, masterKey: server.nodeKey }),
      });
      expect(denied.status).toBe(400);
      expect(await denied.json()).toEqual({ error: "OwnableUnauthorizedAccount" });
    } finally {
      await stranger.close();
    }
  });

  it("lets the owner relayer register the node, then opts in and decrypts SMTP", async () => {
    const registered = await fetch(`${relayer.url}/nodes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain, masterKey: server.nodeKey }),
    });
    expect(registered.status).toBe(200);
    expect(await nodeOf(stack, server.nodeKey)).toBe(domain);

    session = await registerViaRelayer(relayer.url, name);
    await optInViaRelayer(session, name, server.nodeKey);
    expect(await isOptedIn(stack, name, server.nodeKey)).toBe(true);

    const blobs = createBlobStore();
    const index = createMailIndex({
      isOptedIn: (n, nodeKey) => isOptedIn(stack, n, nodeKey),
    });
    nodeA = await startNode({
      domain,
      nodeKey: server.nodeKey,
      nodeSecret: server.secretKey,
      blobs,
      index,
      registry: {
        isOptedIn: (n, nodeKey) => isOptedIn(stack, n, nodeKey),
        nameRecord: async (n) => {
          const [, , dekPublic, wrappedDek] = await nameRecordOf(stack, n);
          return { dekPublic, wrappedDek };
        },
      },
    });

    const sent = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail-user@example.com",
      to: `${oeId}@${domain}`,
      data: rfc5322,
    });
    expect(sent.rcptCode).toBe(250);
    expect(sent.dataCode).toBe(250);

    const rows = (await (await fetch(`${nodeA.url}/index/${name}`)).json()) as {
      seq: number;
      name: string;
      cid: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe(name);

    const blob = new Uint8Array(await (await fetch(`${nodeA.url}/blobs/${rows[0]!.cid}?name=${name}`)).arrayBuffer());
    const dekPrivate = unwrapDek(hexToBytes(session.wrappedDek), session.kek);
    const plaintext = new TextDecoder().decode(await openEnvelope(dekPrivate, name, blob));
    expect(plaintext).toContain("Subject: owner-registered receive");
    expect(plaintext).toContain("hello after owner registration");

    const home = await (await fetch(nodeA.url)).text();
    expect(home).toContain(domain);
  });

  it("rejects opt-in to an unapproved node", async () => {
    const unapproved = keccak256(toBytes("not-a-node"));
    const challengeRes = await fetch(
      `${relayer.url}/opt-in-challenge?name=${name}&nodeKey=${unapproved}`,
    );
    const { challenge } = (await challengeRes.json()) as { challenge: `0x${string}` };
    const res = await fetch(`${relayer.url}/opt-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        nodeKey: unapproved,
        auth: signWebAuthn(hexToBytes(challenge), session.passkey.secretKey),
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "UnknownNode" });
    expect(await isOptedIn(stack, name, unapproved)).toBe(false);
  });
});
