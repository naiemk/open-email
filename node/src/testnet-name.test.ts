import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes, zeroHash, type Hex } from "viem";
import { generateDek, wrapDek } from "../../client/src/dek.ts";
import { generatePasskey, signWebAuthn } from "../../client/src/passkey.ts";
import { unwrapDek } from "../../client/src/dek.ts";
import { openEnvelope } from "../../client/src/envelope.ts";
import { createMailIndex } from "../../dal/src/indexLog.ts";
import { createBlobStore } from "../../dal/src/storage.ts";
import {
  ANVIL_PRIVATE_KEY,
  ensureRegistryBuilt,
  isOptedIn,
  nameRecordOf,
  mailboxGenerationOf,
  startAnvilStack,
  type AnvilStack,
} from "../../relayer/src/anvil.ts";
import { optInViaRelayer, registerNodeViaRelayer, registerViaRelayer, type RelayerSession } from "../../relayer/src/ops.ts";
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
  "Subject: testnet receive",
  "",
  "hello on a testnet name",
  "",
].join("\r\n");

describe("testnet names through receive", () => {
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
    session = await registerViaRelayer(relayer.url, name);
    await registerNodeViaRelayer(relayer.url, domain, server.nodeKey);
    await optInViaRelayer(session, name, server.nodeKey);

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
        mailboxGeneration: (name) => mailboxGenerationOf(stack, name),
      },
    });
  });

  afterAll(async () => {
    await nodeA?.close();
    await relayer?.close();
    await stack?.stop();
  });

  it("registers alice.testnet, accepts SMTP at alice@testnet.crypted.email, and decrypts on the node UI origin", async () => {
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
    expect(plaintext).toContain("Subject: testnet receive");
    expect(plaintext).toContain("hello on a testnet name");

    const home = await (await fetch(nodeA.url)).text();
    expect(home).toContain('id="root"');
    const meta = (await (await fetch(`${nodeA.url}/meta`)).json()) as { domain: string };
    expect(meta.domain).toBe(domain);
  });

  it("rejects the registry name as a local-part and a recipient on another domain", async () => {
    const dottedLocal = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail-user@example.com",
      to: `${name}@${domain}`,
      data: rfc5322,
    });
    expect(dottedLocal.rcptCode).toBe(550);

    const wrongHost = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail-user@example.com",
      to: `${oeId}@crypted.email`,
      data: rfc5322,
    });
    expect(wrongHost.rcptCode).toBe(550);

    const unknown = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail-user@example.com",
      to: `nobody@${domain}`,
      data: rfc5322,
    });
    expect(unknown.rcptCode).toBe(550);
  });

  it("rejects an unsuffixed OE id and a short stem on the testnet registry", async () => {
    const passkey = generatePasskey();
    const dek = generateDek();
    const wrappedDek = bytesToHex(wrapDek(dek.privateKey, new Uint8Array(32).fill(9)));
    const dekPublic = bytesToHex(dek.publicKey);

    const unsuffixed = await postRegister("alice", passkey, dekPublic, wrappedDek);
    expect(unsuffixed.status).toBe(400);
    expect(await unsuffixed.json()).toEqual({ error: "MissingTestnetSuffix" });

    const shortStem = await postRegister("al.testnet", passkey, dekPublic, wrappedDek);
    expect(shortStem.status).toBe(400);
    expect(await shortStem.json()).toEqual({ error: "StemTooShort" });
  });

  async function postRegister(
    registerName: string,
    passkey: ReturnType<typeof generatePasskey>,
    dekPublic: Hex,
    wrappedDek: Hex,
  ) {
    const challengeRes = await fetch(
      `${relayer.url}/register-challenge?name=${registerName}&dekPublic=${dekPublic}&wrappedDek=${wrappedDek}`,
    );
    const { challenge } = (await challengeRes.json()) as { challenge: Hex };
    return fetch(`${relayer.url}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: registerName,
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
  }
});
