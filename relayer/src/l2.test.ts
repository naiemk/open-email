import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes, zeroHash, type Hex } from "viem";
import { generateDek, unwrapDek, wrapDek } from "../../client/src/dek.ts";
import { openEnvelope } from "../../client/src/envelope.ts";
import { generatePasskey, signWebAuthn } from "../../client/src/passkey.ts";
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
const domain = "crypted.email";
const stem = `oe${Date.now().toString(36)}`;
const name = `${stem}.testnet`;
const rfc5322 = [
  "From: gmail-user@example.com",
  `To: ${name}@${domain}`,
  "Subject: sepolia first receive",
  "",
  "hello on ethereum sepolia",
  "",
].join("\r\n");

describe.skipIf(!env)("Sepolia first-receive seam", { timeout: 180_000 }, () => {
  let relayer: RunningRelayer;
  let nodeA: RunningNode;
  let session: RelayerSession;
  let registry: `0x${string}`;
  let publicClient: Awaited<ReturnType<typeof deployRegistryOnL2>>["publicClient"];
  const nodeMaster = generateNodeServerKey();

  beforeAll(async () => {
    if (!env) return;
    const deployed = await deployRegistryOnL2(env);
    registry = deployed.registry;
    publicClient = deployed.publicClient;
    expect(await publicClient.getChainId()).toBe(l2Chain.id);

    relayer = await startRelayer({
      rpcUrl: env.rpcUrl,
      registry,
      privateKey: env.privateKey,
      chain: l2Chain,
    });
    session = await registerViaRelayer(relayer.url, name);
    await registerNodeViaRelayer(relayer.url, domain, nodeMaster.nodeKey);
    await optInViaRelayer(session, name, nodeMaster.nodeKey);

    const handle = { publicClient, registry };
    const blobs = createBlobStore();
    const index = createMailIndex({
      isOptedIn: (n, nodeKey) => isOptedIn(handle, n, nodeKey),
    });
    nodeA = await startNode({
      domain,
      nodeKey: nodeMaster.nodeKey,
      nodeSecret: nodeMaster.secretKey,
      blobs,
      index,
      registry: {
        isOptedIn: (n, nodeKey) => isOptedIn(handle, n, nodeKey),
        nameRecord: async (n) => {
          const [, , dekPublic, wrappedDek] = await nameRecordOf(handle, n);
          return { dekPublic, wrappedDek };
        },
      },
    });
  }, 180_000);

  afterAll(async () => {
    await nodeA?.close();
    await relayer?.close();
  });

  it("registers {oe-id}.testnet, opts into an owner-registered node, and decrypts SMTP on that node", async () => {
    expect(await p256verifyIsNative(publicClient)).toBe(true);
    expect(await isOptedIn({ publicClient, registry }, name, nodeMaster.nodeKey)).toBe(true);

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
    expect(plaintext).toContain("Subject: sepolia first receive");
    expect(plaintext).toContain("hello on ethereum sepolia");

    const home = await (await fetch(nodeA.url)).text();
    expect(home).toContain(domain);
  });

  it('rejects register("alice") on the Sepolia registry', async () => {
    const passkey = generatePasskey();
    const dek = generateDek();
    const wrappedDek = bytesToHex(wrapDek(dek.privateKey, new Uint8Array(32).fill(9)));
    const dekPublic = bytesToHex(dek.publicKey);
    const challengeRes = await fetch(
      `${relayer.url}/register-challenge?name=alice&dekPublic=${dekPublic}&wrappedDek=${wrappedDek}`,
    );
    const { challenge } = (await challengeRes.json()) as { challenge: Hex };
    const res = await fetch(`${relayer.url}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "alice",
        qx: passkey.qx,
        qy: passkey.qy,
        dekPublic,
        wrappedDek,
        auth: challenge
          ? signWebAuthn(hexToBytes(challenge), passkey.secretKey)
          : {
              r: zeroHash,
              s: zeroHash,
              challengeIndex: 0,
              typeIndex: 0,
              authenticatorData: "0x" as Hex,
              clientDataJSON: "",
            },
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "MissingTestnetSuffix" });
  });
});

describe.skipIf(!!process.env.RUN_L2_TESTS)("Sepolia first-receive stays off by default", () => {
  it("does not load a funded relayer when RUN_L2_TESTS is unset", () => {
    expect(env).toBeUndefined();
    expect(l2Chain.id).toBe(11_155_111);
    expect(defaultL2RpcUrl).toContain("ethereum-sepolia");
  });
});
