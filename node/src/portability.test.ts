import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hexToBytes } from "viem";
import { unwrapDek } from "../../client/src/dek.ts";
import { openEnvelope } from "../../client/src/envelope.ts";
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
  "Subject: portable mail",
  "",
  "same mailbox on every opted-in node",
  "",
].join("\r\n");

describe("two-node portable mailbox", () => {
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
    await optInViaRelayer(session, "alice", keyB.nodeKey);

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
    });
    nodeB = await startNode({
      domain: "node-b.test",
      nodeKey: keyB.nodeKey,
      nodeSecret: keyB.secretKey,
      blobs,
      index,
      registry,
    });
  });

  afterAll(async () => {
    await nodeA?.close();
    await nodeB?.close();
    await relayer?.close();
    await stack?.stop();
  });

  it("shows mail SMTP'd only to A as decrypted plaintext on B's API and UI origin", async () => {
    const sent = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail-user@example.com",
      to: "alice@node-a.test",
      data: rfc5322,
    });
    expect(sent.dataCode).toBe(250);

    const neverToB = await sendSmtp({
      host: "127.0.0.1",
      port: nodeB.smtpPort,
      from: "gmail-user@example.com",
      to: "skip@node-b.test",
      data: rfc5322,
    });
    expect(neverToB.rcptCode).toBe(550);

    const rowsA = (await (await fetch(`${nodeA.url}/index/alice`)).json()) as { cid: string }[];
    const rowsB = (await (await fetch(`${nodeB.url}/index/alice`)).json()) as { cid: string }[];
    expect(rowsB).toEqual(rowsA);
    expect(rowsB).toHaveLength(1);

    const blob = new Uint8Array(await (await fetch(`${nodeB.url}/blobs/${rowsB[0]!.cid}`)).arrayBuffer());
    const dekPrivate = unwrapDek(hexToBytes(session.wrappedDek), session.kek);
    const plaintext = new TextDecoder().decode(await openEnvelope(dekPrivate, "alice", blob));
    expect(plaintext).toContain("portable mail");

    const pageB = await (await fetch(nodeB.url)).text();
    expect(pageB).toContain("node-b.test");
    expect(pageB).not.toContain(nodeA.url);
    expect(pageB).not.toContain("node-a.test");
    const uiB = await (await fetch(`${nodeB.url}/ui.js`)).text();
    expect(uiB).toContain("/index/");
    expect(uiB).toContain("/blobs/");
    expect(uiB).not.toContain(nodeA.url);
  });

  it("after opt-out of A, new SMTP to A is 550 and B still has the old message", async () => {
    const before = (await (await fetch(`${nodeB.url}/index/alice`)).json()) as unknown[];
    await optOutViaRelayer(session, "alice", keyA.nodeKey);
    expect(await isOptedIn(stack, "alice", keyA.nodeKey)).toBe(false);
    expect(await isOptedIn(stack, "alice", keyB.nodeKey)).toBe(true);

    const again = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail-user@example.com",
      to: "alice@node-a.test",
      data: rfc5322,
    });
    expect(again.rcptCode).toBe(550);

    const after = (await (await fetch(`${nodeB.url}/index/alice`)).json()) as unknown[];
    expect(after).toHaveLength(before.length);
    const blob = new Uint8Array(
      await (await fetch(`${nodeB.url}/blobs/${(after[0] as { cid: string }).cid}`)).arrayBuffer(),
    );
    const dekPrivate = unwrapDek(hexToBytes(session.wrappedDek), session.kek);
    expect(new TextDecoder().decode(await openEnvelope(dekPrivate, "alice", blob))).toContain("portable mail");
  });
});
