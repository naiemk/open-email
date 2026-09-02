import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "viem";
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

const rfc5322 = [
  "From: gmail-user@example.com",
  "To: alice@node-a.test",
  "Subject: tracer mail",
  "",
  "hello from the rest of the internet",
  "",
].join("\r\n");

describe("headless mail through node A", () => {
  let stack: AnvilStack;
  let relayer: RunningRelayer;
  let nodeA: RunningNode;
  let session: RelayerSession;
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
    session = await registerViaRelayer(relayer.url, "alice");
    await registerNodeViaRelayer(relayer.url, "node-a.test", server.nodeKey);
    await optInViaRelayer(session, "alice", server.nodeKey);

    blobs = createBlobStore();
    const index = createMailIndex({
      isOptedIn: (name, nodeKey) => isOptedIn(stack, name, nodeKey),
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
        mailboxGeneration: (name) => mailboxGenerationOf(stack, name),
      },
    });
  });

  afterAll(async () => {
    await nodeA?.close();
    await relayer?.close();
    await stack?.stop();
  });

  it("returns 550 for an unknown or not-opted-in name and does not write the index", async () => {
    const unknown = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail-user@example.com",
      to: "nobody@node-a.test",
      data: rfc5322,
    });
    expect(unknown.rcptCode).toBe(550);
    expect((await (await fetch(`${nodeA.url}/index/nobody`)).json()) as unknown[]).toEqual([]);
  });

  it("accepts SMTP for an opted-in name, pins an HPKE blob, and decrypts via A's API", async () => {
    const sent = await sendSmtp({
      host: "127.0.0.1",
      port: nodeA.smtpPort,
      from: "gmail-user@example.com",
      to: "alice@node-a.test",
      data: rfc5322,
    });
    expect(sent.rcptCode).toBe(250);
    expect(sent.dataCode).toBe(250);

    const rows = (await (await fetch(`${nodeA.url}/index/alice`)).json()) as {
      seq: number;
      name: string;
      cid: string;
      size: number;
      direction: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.seq).toBe(1);
    expect(rows[0]?.name).toBe("alice");
    expect(rows[0]?.direction).toBe("in");

    expect((await fetch(`${nodeA.url}/blobs/${rows[0]!.cid}`)).status).toBe(404);
    const blobRes = await fetch(`${nodeA.url}/blobs/${rows[0]!.cid}?name=alice`);
    expect(blobRes.status).toBe(200);
    const blob = new Uint8Array(await blobRes.arrayBuffer());
    expect(rows[0]?.size).toBe(blob.byteLength);

    const storage = (await (await fetch(`${nodeA.url}/storage/alice`)).json()) as {
      total_size: number;
      cap: number;
      warn: boolean;
    };
    expect(storage.total_size).toBe(blob.byteLength);
    expect(storage.cap).toBe(5 * 1024 * 1024);
    expect(storage.warn).toBe(false);
    expect(new TextDecoder().decode(blob)).not.toContain("Subject: tracer mail");
    expect(new TextDecoder().decode(blob)).not.toContain("hello from the rest of the internet");

    const dekPrivate = unwrapDek(hexToBytes(session.wrappedDek), session.kek);
    const plaintext = new TextDecoder().decode(await openEnvelope(dekPrivate, "alice", blob));
    expect(plaintext).toContain("Subject: tracer mail");
    expect(plaintext).toContain("hello from the rest of the internet");

    const home = await (await fetch(nodeA.url)).text();
    expect(home).toContain('id="root"');
    const meta = (await (await fetch(`${nodeA.url}/meta`)).json()) as { domain: string };
    expect(meta.domain).toBe("node-a.test");
    expect(home).not.toContain("node-b.test");
    expect(home).not.toContain(bytesToHex(session.dek.privateKey));
    expect(home).not.toContain("KEK hex");
  });

  it("pages the index newest-first and caps a page at 100", async () => {
    for (const n of [2, 3]) {
      const sent = await sendSmtp({
        host: "127.0.0.1",
        port: nodeA.smtpPort,
        from: "gmail-user@example.com",
        to: "alice@node-a.test",
        data: [
          "From: gmail-user@example.com",
          "To: alice@node-a.test",
          `Subject: mail ${n}`,
          "",
          `body ${n}`,
          "",
        ].join("\r\n"),
      });
      expect(sent.dataCode).toBe(250);
    }
    const page = (await (await fetch(`${nodeA.url}/index/alice?limit=2`)).json()) as { seq: number }[];
    expect(page.map((r) => r.seq)).toEqual([3, 2]);
    const older = (await (await fetch(`${nodeA.url}/index/alice?limit=2&before=2`)).json()) as { seq: number }[];
    expect(older.map((r) => r.seq)).toEqual([1]);
  });
});
