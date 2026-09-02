/** Starts two-node Anvil stack and prints E2E_URLS for Playwright globalSetup. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { bytesToHex, type Hex } from "viem";
import { ensureRegistryBuilt, startAnvilStack, isOptedIn, nameRecordOf, mailboxGenerationOf } from "../relayer/src/anvil.ts";
import { registerNodeViaRelayer, registerViaRelayer, optInViaRelayer } from "../relayer/src/ops.ts";
import { startRelayer, type RunningRelayer } from "../relayer/src/server.ts";
import { ANVIL_PRIVATE_KEY } from "../relayer/src/anvil.ts";
import { createMailIndex } from "../dal/src/indexLog.ts";
import { createBlobStore } from "../dal/src/storage.ts";
import { generateNodeServerKey } from "../node/src/keys.ts";
import { startNode, type RunningNode } from "../node/src/node.ts";

ensureRegistryBuilt();
const stack = await startAnvilStack();
const relayer: RunningRelayer = await startRelayer({
  rpcUrl: stack.rpcUrl,
  registry: stack.registry,
  privateKey: ANVIL_PRIVATE_KEY,
});
const keyA = generateNodeServerKey();
const keyB = generateNodeServerKey();
const session = await registerViaRelayer(relayer.url, "alice");
await registerNodeViaRelayer(relayer.url, "node-a.test", keyA.nodeKey);
await registerNodeViaRelayer(relayer.url, "node-b.test", keyB.nodeKey);
await optInViaRelayer(session, "alice", keyA.nodeKey);

const blobs = createBlobStore();
const index = createMailIndex({
  isOptedIn: (name, nodeKey) => isOptedIn(stack, name, nodeKey),
});
const registry = {
  isOptedIn: (name: string, nodeKey: typeof keyA.nodeKey) => isOptedIn(stack, name, nodeKey),
  nameRecord: async (name: string) => {
    const [, , dekPublic, wrappedDek] = await nameRecordOf(stack, name);
    return { dekPublic, wrappedDek };
  },
  mailboxGeneration: (name: string) => mailboxGenerationOf(stack, name),
};

const uiBuilt = existsSync(join(process.cwd(), "node/web/dist/index.html"));

const mockCredentialId = bytesToHex(randomBytes(16)) as Hex;
const mockConfig = {
  oeId: "alice",
  credentialId: mockCredentialId,
  qx: session.passkey.qx,
  qy: session.passkey.qy,
  secretHex: bytesToHex(session.passkey.secretKey) as Hex,
};

const nodeA = await startNode({
  domain: "node-a.test",
  nodeKey: keyA.nodeKey,
  nodeSecret: keyA.secretKey,
  blobs,
  index,
  registry,
  relayerUrl: relayer.url,
  devMode: { mockPasskey: true, mockConfig },
});
const nodeB = await startNode({
  domain: "node-b.test",
  nodeKey: keyB.nodeKey,
  nodeSecret: keyB.secretKey,
  blobs,
  index,
  registry,
  relayerUrl: relayer.url,
  devMode: { mockPasskey: true },
});

console.log(`E2E_URLS ${JSON.stringify({ nodeA: nodeA.url, nodeB: nodeB.url, uiBuilt })}`);

process.on("SIGTERM", async () => {
  await nodeA.close();
  await nodeB.close();
  await relayer.close();
  await stack.stop();
  process.exit(0);
});

await new Promise(() => undefined);
