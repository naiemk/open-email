import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, hexToBytes, http } from "viem";
import { unwrapDek } from "../../client/src/dek.ts";
import { openEnvelope } from "../../client/src/envelope.ts";
import { createMailIndex } from "../../dal/src/indexLog.ts";
import { createBlobStore } from "../../dal/src/storage.ts";
import { generateNodeServerKey } from "../../node/src/keys.ts";
import { startNode, type RunningNode } from "../../node/src/node.ts";
import { sendSmtp } from "../../node/src/smtpSend.ts";
import { isOptedIn, nameRecordOf } from "./anvil.ts";
import { defaultL2RpcUrl, deployRegistryOnL2, l2Chain, p256verifyIsNative, readL2RelayerEnv } from "./l2.ts";
import {
  optInViaRelayer,
  registerNodeViaRelayer,
  registerViaRelayer,
  type RelayerSession,
} from "./ops.ts";
import { startRelayer, type RunningRelayer } from "./server.ts";

const env = process.env.RUN_L2_TESTS ? readL2RelayerEnv() : undefined;

describe.skipIf(!env)("Base Sepolia P256VERIFY", { timeout: 30_000 }, () => {
  it("exposes native RIP-7212 at 0x100", async () => {
    const publicClient = createPublicClient({
      chain: l2Chain,
      transport: http(env?.rpcUrl ?? defaultL2RpcUrl),
    });
    expect(await p256verifyIsNative(publicClient)).toBe(true);
  });
});

const rfc5322 = [
  "From: gmail-user@example.com",
  "To: alice@node-a.test",
  "Subject: l2 tracer mail",
  "",
  "same mailbox on Base Sepolia",
  "",
].join("\r\n");

describe.skipIf(!env)("same seam on Base Sepolia", { timeout: 180_000 }, () => {
  let relayer: RunningRelayer;
  let nodeA: RunningNode;
  let nodeB: RunningNode;
  let session: RelayerSession;
  let registry: `0x${string}`;
  let publicClient: Awaited<ReturnType<typeof deployRegistryOnL2>>["publicClient"];
  const keyA = generateNodeServerKey();
  const keyB = generateNodeServerKey();
  const name = `oe${Date.now().toString(36)}`;

  beforeAll(async () => {
    if (!env) return;
    const deployed = await deployRegistryOnL2(env);
    registry = deployed.registry;
    publicClient = deployed.publicClient;

    relayer = await startRelayer({
      rpcUrl: env.rpcUrl,
      registry,
      privateKey: env.privateKey,
      chain: l2Chain,
    });
    session = await registerViaRelayer(relayer.url, name);
    await registerNodeViaRelayer(relayer.url, "node-a.test", keyA.nodeKey);
    await registerNodeViaRelayer(relayer.url, "node-b.test", keyB.nodeKey);
    await optInViaRelayer(session, name, keyA.nodeKey);
    await optInViaRelayer(session, name, keyB.nodeKey);

    const handle = { publicClient, registry };
    const blobs = createBlobStore();
    const index = createMailIndex({
      isOptedIn: (n, nodeKey) => isOptedIn(handle, n, nodeKey),
    });
    const registryApi = {
      isOptedIn: (n: string, nodeKey: typeof keyA.nodeKey) => isOptedIn(handle, n, nodeKey),
      nameRecord: async (n: string) => {
        const [, , dekPublic, wrappedDek] = await nameRecordOf(handle, n);
        return { dekPublic, wrappedDek };
      },
    };
    nodeA = await startNode({
      domain: "node-a.test",
      nodeKey: keyA.nodeKey,
      nodeSecret: keyA.secretKey,
      blobs,
      index,
      registry: registryApi,
    });
    nodeB = await startNode({
      domain: "node-b.test",
      nodeKey: keyB.nodeKey,
      nodeSecret: keyB.secretKey,
      blobs,
      index,
      registry: registryApi,
    });
  }, 180_000);

  afterAll(async () => {
    await nodeA?.close();
    await nodeB?.close();
    await relayer?.close();
  });

  it("registers and opts in via the relayer, using native P256VERIFY", async () => {
    expect(await p256verifyIsNative(publicClient)).toBe(true);
    expect(await isOptedIn({ publicClient, registry }, name, keyA.nodeKey)).toBe(true);
    expect(await isOptedIn({ publicClient, registry }, name, keyB.nodeKey)).toBe(true);
  });

  it("SMTP into local A decrypts on B while registry reads are the testnet", async () => {
    const sent = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail-user@example.com",
      to: `${name}@node-a.test`,
      data: rfc5322,
    });
    expect(sent.dataCode).toBe(250);

    const rowsB = (await (await fetch(`${nodeB.url}/index/${name}`)).json()) as { cid: string }[];
    expect(rowsB).toHaveLength(1);
    const blob = new Uint8Array(await (await fetch(`${nodeB.url}/blobs/${rowsB[0]!.cid}`)).arrayBuffer());
    const dekPrivate = unwrapDek(hexToBytes(session.wrappedDek), session.kek);
    const plaintext = new TextDecoder().decode(await openEnvelope(dekPrivate, name, blob));
    expect(plaintext).toContain("l2 tracer mail");

    const pageB = await (await fetch(nodeB.url)).text();
    expect(pageB).toContain("node-b.test");
    expect(pageB).not.toContain(nodeA.url);
  });
});
