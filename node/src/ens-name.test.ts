import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hexToBytes } from "viem";
import { signWebAuthn } from "../../client/src/passkey.ts";
import { createMailIndex } from "../../dal/src/indexLog.ts";
import { createBlobStore } from "../../dal/src/storage.ts";
import {
  ANVIL_PRIVATE_KEY,
  defaultRegistryClient,
  ensureRegistryBuilt,
  isOptedIn,
  startAnvilStack,
  type AnvilStack,
} from "../../relayer/src/anvil.ts";
import { deployEnsClaimFixture } from "../../relayer/src/ens-test-helpers.ts";
import { registerNodeViaRelayer } from "../../relayer/src/ops.ts";
import { startRelayer, type RunningRelayer } from "../../relayer/src/server.ts";
import { generateNodeServerKey } from "./keys.ts";
import { startNode, type RunningNode } from "./node.ts";
import { sendSmtp } from "./smtpSend.ts";

const ensName = "vitalik.eth";
const domain = "testnet.crypted.email";

describe("linked ENS SMTP", () => {
  let stack: AnvilStack;
  let relayer: RunningRelayer;
  let nodeA: RunningNode;
  const server = generateNodeServerKey();
  let ensGateOpen = true;

  beforeAll(async () => {
    ensureRegistryBuilt();
    stack = await startAnvilStack({ testnetMode: true });
    relayer = await startRelayer({
      rpcUrl: stack.rpcUrl,
      registry: stack.registry,
      privateKey: ANVIL_PRIVATE_KEY,
    });
    const ens = await deployEnsClaimFixture(stack);
    await ens.claimName(ensName);
    await registerNodeViaRelayer(relayer.url, domain, server.nodeKey);

    const challengeRes = await fetch(
      `${relayer.url}/opt-in-challenge?name=${encodeURIComponent(ensName)}&nodeKey=${server.nodeKey}`,
    );
    const { challenge } = (await challengeRes.json()) as { challenge: string };
    const auth = signWebAuthn(hexToBytes(challenge as `0x${string}`), ens.passkey.secretKey);
    const optRes = await fetch(`${relayer.url}/opt-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: ensName,
        nodeKey: server.nodeKey,
        qx: ens.passkey.qx,
        qy: ens.passkey.qy,
        auth,
      }),
    });
    expect(optRes.ok).toBe(true);

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
      registry: defaultRegistryClient(stack),
      ensGate: {
        allowsReceive: async () => ensGateOpen,
      },
    });
  });

  afterAll(async () => {
    await nodeA?.close();
    await relayer?.close();
    await stack?.stop();
  });

  it("is opted in after claim", async () => {
    expect(await isOptedIn(stack, ensName, server.nodeKey)).toBe(true);
  });

  it("accepts vitalik.eth@testnet.crypted.email when opted in", async () => {
    const rfc5322 = [
      "From: gmail@example.com",
      `To: ${ensName}@${domain}`,
      "Subject: ens inbound",
      "",
      "hello ens",
      "",
    ].join("\r\n");
    const sent = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail@example.com",
      to: `${ensName}@${domain}`,
      data: rfc5322,
    });
    expect(sent.rcptCode).toBe(250);
    expect(sent.dataCode).toBe(250);

    const rows = (await (await fetch(`${nodeA.url}/index/${ensName}`)).json()) as { cid: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("550 when ensGate says owner moved", async () => {
    ensGateOpen = false;
    const sent = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail@example.com",
      to: `${ensName}@${domain}`,
      data: "Subject: x\r\n\r\ny\r\n",
    });
    expect(sent.rcptCode).toBe(550);
    ensGateOpen = true;
  });
});
