import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hexToBytes } from "viem";
import { unwrapDek } from "../../client/src/dek.ts";
import { openEnvelope } from "../../client/src/envelope.ts";
import { signWebAuthn } from "../../client/src/passkey.ts";
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
import { optInViaRelayer, registerNodeViaRelayer, registerViaRelayer, type RelayerSession } from "../../relayer/src/ops.ts";
import { startRelayer, type RunningRelayer } from "../../relayer/src/server.ts";
import { generateNodeServerKey } from "./keys.ts";
import { startNode, type RunningNode } from "./node.ts";
import { sendSmtp } from "./smtpSend.ts";
import { createMemoryInvoices } from "./signup.ts";

const dkim = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = dkim.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("send to the internet", () => {
  let stack: AnvilStack;
  let relayer: RunningRelayer;
  let nodeA: RunningNode;
  let session: RelayerSession;
  const server = generateNodeServerKey();
  const outbound: { mailFrom: string; rcptTo: string; data: string }[] = [];
  let now = 1_700_000_000_000;

  beforeAll(async () => {
    ensureRegistryBuilt();
    stack = await startAnvilStack();
    relayer = await startRelayer({
      rpcUrl: stack.rpcUrl,
      registry: stack.registry,
      privateKey: ANVIL_PRIVATE_KEY,
    });
    session = await registerViaRelayer(relayer.url, "alice");
    await registerNodeViaRelayer(relayer.url, "node-a.test", server.nodeKey);
    await optInViaRelayer(session, "alice", server.nodeKey);

    const blobs = createBlobStore();
    const index = createMailIndex({
      isOptedIn: (name, nodeKey) => isOptedIn(stack, name, nodeKey),
      cap: 50_000,
    });
    nodeA = await startNode({
      domain: "node-a.test",
      nodeKey: server.nodeKey,
      nodeSecret: server.secretKey,
      blobs,
      index,
      registry: {
        isOptedIn: (name, nodeKey) => isOptedIn(stack, name, nodeKey),
        nameRecord: async (name) => {
          const [, , dekPublic, wrappedDek] = await nameRecordOf(stack, name);
          return { dekPublic, wrappedDek };
        },
      },
      send: {
        turnstile: { verify: async (token) => token === "ok" },
        deliver: async (mail) => {
          outbound.push(mail);
          return 250;
        },
        dkim: { selector: "oe1", domain: "node-a.test", privateKeyPem },
        now: () => now,
      },
      signup: {
        relayerUrl: relayer.url,
        turnstile: { verify: async (token) => token === "ok" },
        invoices: createMemoryInvoices(),
      },
    });
  });

  afterAll(async () => {
    await nodeA?.close();
    await relayer?.close();
    await stack?.stop();
  });

  it("DKIM-signs outbound mail and indexes a sent copy", async () => {
    const denied = await fetch(`${nodeA.url}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "alice",
        to: "pat@gmail.com",
        subject: "Lunch",
        body: "See you at 1.",
        turnstile: "nope",
      }),
    });
    expect(denied.status).toBe(403);

    const res = await fetch(`${nodeA.url}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "alice",
        to: "pat@gmail.com",
        subject: "Lunch",
        body: "See you at 1.",
        turnstile: "ok",
      }),
    });
    expect(res.status).toBe(200);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]?.mailFrom).toBe("alice@node-a.test");
    expect(outbound[0]?.rcptTo).toBe("pat@gmail.com");
    expect(outbound[0]?.data).toContain("From: alice@node-a.test");
    expect(outbound[0]?.data).toContain("To: pat@gmail.com");
    expect(outbound[0]?.data).toContain("Subject: Lunch");
    expect(outbound[0]?.data).toContain("See you at 1.");
    expect(outbound[0]?.data).toMatch(/DKIM-Signature:[\s\S]*s=oe1;/);
    expect(outbound[0]?.data).toMatch(/DKIM-Signature:[\s\S]*d=node-a.test;/);

    const rows = (await (await fetch(`${nodeA.url}/index/alice`)).json()) as {
      seq: number;
      cid: string;
      direction: string;
    }[];
    expect(rows[0]?.direction).toBe("out");
    const blob = new Uint8Array(
      await (await fetch(`${nodeA.url}/blobs/${rows[0]!.cid}?name=alice`)).arrayBuffer(),
    );
    const dekPrivate = unwrapDek(hexToBytes(session.wrappedDek), session.kek);
    const plaintext = new TextDecoder().decode(await openEnvelope(dekPrivate, "alice", blob));
    expect(plaintext).toContain("Subject: Lunch");
    expect(plaintext).toContain("See you at 1.");
  });

  it("submits SMTP-out for an opted-in name to an internet recipient", async () => {
    outbound.length = 0;
    const sent = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "alice@node-a.test",
      to: "pat@gmail.com",
      data: [
        "From: alice@node-a.test",
        "To: pat@gmail.com",
        "Subject: smtp out",
        "",
        "via smtp",
        "",
      ].join("\r\n"),
    });
    expect(sent.rcptCode).toBe(250);
    expect(sent.dataCode).toBe(250);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]?.rcptTo).toBe("pat@gmail.com");
    expect(outbound[0]?.data).toMatch(/DKIM-Signature:[\s\S]*s=oe1;/);
    const rows = (await (await fetch(`${nodeA.url}/index/alice`)).json()) as { direction: string }[];
    expect(rows.some((r) => r.direction === "out")).toBe(true);
  });

  it("rate-limits send at 20/hour (429) and SMTP-out with 452", async () => {
    for (let i = 0; i < 18; i++) {
      const res = await fetch(`${nodeA.url}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "alice",
          to: "pat@gmail.com",
          subject: `n${i}`,
          body: "x",
          turnstile: "ok",
        }),
      });
      expect(res.status).toBe(200);
    }
    const limited = await fetch(`${nodeA.url}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "alice",
        to: "pat@gmail.com",
        subject: "too many",
        body: "x",
        turnstile: "ok",
      }),
    });
    expect(limited.status).toBe(429);
    const smtp = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "alice@node-a.test",
      to: "pat@gmail.com",
      data: "From: alice@node-a.test\r\nTo: pat@gmail.com\r\nSubject: x\r\n\r\nx\r\n",
    });
    expect(smtp.dataCode).toBe(452);
  });

  it("rate-limits opt-in and opt-out at 2/hour", async () => {
    const first = await optThroughNode("opt-in");
    expect(first.status).toBe(200);
    const second = await optThroughNode("opt-in");
    expect(second.status).toBe(200);
    const third = await optThroughNode("opt-in");
    expect(third.status).toBe(429);
  });

  async function optThroughNode(path: "opt-in" | "opt-out") {
    const challengeRes = await fetch(
      `${nodeA.url}/api/${path}-challenge?name=alice&nodeKey=${server.nodeKey}`,
    );
    const { challenge } = (await challengeRes.json()) as { challenge: `0x${string}` };
    return fetch(`${nodeA.url}/api/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "alice",
        nodeKey: server.nodeKey,
        auth: signWebAuthn(hexToBytes(challenge), session.passkey.secretKey),
      }),
    });
  }
});

describe("outbound storage cap", () => {
  let stack: AnvilStack;
  let relayer: RunningRelayer;
  let nodeA: RunningNode;
  const server = generateNodeServerKey();
  const outbound: unknown[] = [];

  beforeAll(async () => {
    ensureRegistryBuilt();
    stack = await startAnvilStack();
    relayer = await startRelayer({
      rpcUrl: stack.rpcUrl,
      registry: stack.registry,
      privateKey: ANVIL_PRIVATE_KEY,
    });
    const session = await registerViaRelayer(relayer.url, "alice");
    await registerNodeViaRelayer(relayer.url, "node-a.test", server.nodeKey);
    await optInViaRelayer(session, "alice", server.nodeKey);
    nodeA = await startNode({
      domain: "node-a.test",
      nodeKey: server.nodeKey,
      nodeSecret: server.secretKey,
      blobs: createBlobStore(),
      index: createMailIndex({
        isOptedIn: (name, nodeKey) => isOptedIn(stack, name, nodeKey),
        cap: 800,
      }),
      registry: {
        isOptedIn: (name, nodeKey) => isOptedIn(stack, name, nodeKey),
        nameRecord: async (name) => {
          const [, , dekPublic, wrappedDek] = await nameRecordOf(stack, name);
          return { dekPublic, wrappedDek };
        },
      },
      send: {
        turnstile: { verify: async (token) => token === "ok" },
        deliver: async (mail) => {
          outbound.push(mail);
          return 250;
        },
        dkim: { selector: "oe1", domain: "node-a.test", privateKeyPem },
      },
    });
  });

  afterAll(async () => {
    await nodeA?.close();
    await relayer?.close();
    await stack?.stop();
  });

  it("does not deliver when a sent copy would exceed the cap", async () => {
    const res = await fetch(`${nodeA.url}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "alice",
        to: "pat@gmail.com",
        subject: "bulky",
        body: "x".repeat(2000),
        turnstile: "ok",
      }),
    });
    expect(res.status).toBe(452);
    expect(outbound).toHaveLength(0);
    expect((await (await fetch(`${nodeA.url}/index/alice`)).json()) as unknown[]).toEqual([]);
  });
});
