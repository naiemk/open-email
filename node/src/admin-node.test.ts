import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hexToBytes, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { unwrapDek } from "../../client/src/dek.ts";
import { signWebAuthn } from "../../client/src/passkey.ts";
import { openEnvelope } from "../../client/src/envelope.ts";
import { registryAbi } from "../../relayer/src/abi.ts";
import { createMailIndex } from "../../dal/src/indexLog.ts";
import { createBlobStore } from "../../dal/src/storage.ts";
import {
  ANVIL_ACCOUNT_1,
  ANVIL_PRIVATE_KEY,
  approveNode,
  ensureRegistryBuilt,
  isOptedIn,
  nameRecordOf,
  nodeOf,
  setRegistryAdmin,
  startAnvilStack,
  type AnvilStack,
} from "../../relayer/src/anvil.ts";
import { optInViaRelayer, registerViaRelayer, type RelayerSession } from "../../relayer/src/ops.ts";
import { startRelayer, type RunningRelayer } from "../../relayer/src/server.ts";
import { generateNodeServerKey } from "./keys.ts";
import { startNode, type RunningNode } from "./node.ts";
import { sendSmtp } from "./smtpSend.ts";

const name = "alice.testnet";
const domain = "crypted.email";
const rfc5322 = [
  "From: gmail-user@example.com",
  `To: ${name}@${domain}`,
  "Subject: admin-approved receive",
  "",
  "hello after admin approval",
  "",
].join("\r\n");

describe("admin-approved node through receive", () => {
  let stack: AnvilStack;
  let relayer: RunningRelayer;
  let nodeA: RunningNode;
  let session: RelayerSession;
  const server = generateNodeServerKey();
  const admin = privateKeyToAccount(ANVIL_ACCOUNT_1);

  beforeAll(async () => {
    ensureRegistryBuilt();
    stack = await startAnvilStack({ testnetMode: true, admin: false });
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

  it("rejects node registration until the owner assigns an admin who approves domain + master key", async () => {
    const denied = await fetch(`${relayer.url}/nodes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain, masterKey: server.nodeKey }),
    });
    expect(denied.status).toBe(400);
    expect(await denied.json()).toEqual({ error: "NotAdmin" });

    await setRegistryAdmin(stack, admin.address);
    expect(
      await stack.publicClient.readContract({
        address: stack.registry,
        abi: registryAbi,
        functionName: "admin",
      }),
    ).toBe(admin.address);

    await approveNode(stack, domain, server.nodeKey, ANVIL_ACCOUNT_1);
    expect(await nodeOf(stack, server.nodeKey)).toBe(domain);
  });

  it("opts in via the relayer, accepts SMTP, and decrypts on that node", async () => {
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
      to: `${name}@${domain}`,
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

    const blob = new Uint8Array(await (await fetch(`${nodeA.url}/blobs/${rows[0]!.cid}`)).arrayBuffer());
    const dekPrivate = unwrapDek(hexToBytes(session.wrappedDek), session.kek);
    const plaintext = new TextDecoder().decode(await openEnvelope(dekPrivate, name, blob));
    expect(plaintext).toContain("Subject: admin-approved receive");
    expect(plaintext).toContain("hello after admin approval");

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
