import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { optInViaRelayer, registerNodeViaRelayer, registerViaRelayer } from "../../relayer/src/ops.ts";
import { startRelayer, type RunningRelayer } from "../../relayer/src/server.ts";
import { generateNodeServerKey } from "./keys.ts";
import { startNode, type RunningNode } from "./node.ts";
import { sendSmtp } from "./smtpSend.ts";

const small = [
  "From: gmail-user@example.com",
  "To: alice@node-a.test",
  "Subject: small",
  "",
  "hi",
  "",
].join("\r\n");

const bulky = [
  "From: gmail-user@example.com",
  "To: alice@node-a.test",
  "Subject: bulky",
  "",
  "x".repeat(2000),
  "",
].join("\r\n");

describe("index quota and trash", () => {
  let stack: AnvilStack;
  let relayer: RunningRelayer;
  let nodeA: RunningNode;
  let blobs: ReturnType<typeof createBlobStore>;
  const server = generateNodeServerKey();

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

    blobs = createBlobStore();
    const index = createMailIndex({
      isOptedIn: (name, nodeKey) => isOptedIn(stack, name, nodeKey),
      cap: 800,
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
    });
  });

  afterAll(async () => {
    await nodeA?.close();
    await relayer?.close();
    await stack?.stop();
  });

  it("counts sealed bytes, hard-stops inbound at the cap, and frees quota when trash is emptied", async () => {
    const first = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail-user@example.com",
      to: "alice@node-a.test",
      data: small,
    });
    expect(first.rcptCode).toBe(250);
    expect(first.dataCode).toBe(250);

    const rows = (await (await fetch(`${nodeA.url}/index/alice`)).json()) as {
      seq: number;
      cid: string;
      size: number;
      trashed: boolean;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.trashed).toBe(false);

    const afterFirst = (await (await fetch(`${nodeA.url}/storage/alice`)).json()) as {
      total_size: number;
      cap: number;
      warn: boolean;
    };
    expect(afterFirst.total_size).toBe(rows[0]?.size);
    expect(afterFirst.cap).toBe(800);
    expect(afterFirst.warn).toBe(false);

    const over = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail-user@example.com",
      to: "alice@node-a.test",
      data: bulky,
    });
    expect(over.dataCode).toBe(452);
    expect(
      ((await (await fetch(`${nodeA.url}/index/alice`)).json()) as unknown[]).length,
    ).toBe(1);

    const trashed = await fetch(`${nodeA.url}/trash/alice/${rows[0]!.seq}`, { method: "POST" });
    expect(trashed.status).toBe(200);
    const stillCounted = (await (await fetch(`${nodeA.url}/storage/alice`)).json()) as { total_size: number };
    expect(stillCounted.total_size).toBe(afterFirst.total_size);
    const listed = (await (await fetch(`${nodeA.url}/index/alice`)).json()) as { trashed: boolean }[];
    expect(listed[0]?.trashed).toBe(true);

    const emptied = await fetch(`${nodeA.url}/empty-trash/alice`, { method: "POST" });
    expect(emptied.status).toBe(200);
    const freed = (await (await fetch(`${nodeA.url}/storage/alice`)).json()) as { total_size: number };
    expect(freed.total_size).toBe(0);
    expect((await (await fetch(`${nodeA.url}/index/alice`)).json()) as unknown[]).toEqual([]);
    expect((await fetch(`${nodeA.url}/blobs/${rows[0]!.cid}?name=alice`)).status).toBe(404);

    const again = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail-user@example.com",
      to: "alice@node-a.test",
      data: small,
    });
    expect(again.dataCode).toBe(250);
  });
});
