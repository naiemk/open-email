/** Dev node with anvil relayer, demo mailbox, mock passkey, and seeded mail. */
import { generateKeyPairSync } from "node:crypto";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { createMailIndex } from "../dal/src/indexLog.ts";
import { createBlobStore } from "../dal/src/storage.ts";
import {
  ANVIL_PRIVATE_KEY,
  ensureRegistryBuilt,
  isOptedIn,
  nameRecordOf,
  mailboxGenerationOf,
  startAnvilStack,
  type AnvilStack,
} from "../relayer/src/anvil.ts";
import { optInViaRelayer, registerNodeViaRelayer, registerViaRelayer } from "../relayer/src/ops.ts";
import { startRelayer, type RunningRelayer } from "../relayer/src/server.ts";
import { generateNodeServerKey } from "./src/keys.ts";
import { startNode, type RunningNode } from "./src/node.ts";
import { sendSmtp } from "./src/smtpSend.ts";
import { createMemoryInvoices } from "./src/signup.ts";

const domain = "testnet.crypted.email";
const demoName = "demouser.testnet";
const demoOeId = "demouser";

export type DevServer = {
  node: RunningNode;
  url: string;
  mockConfig: {
    oeId: string;
    credentialId: Hex;
    qx: Hex;
    qy: Hex;
    secretHex: Hex;
  };
  close: () => Promise<void>;
};

export async function startDevServer(port = 8787): Promise<DevServer> {
  ensureRegistryBuilt();
  const stack: AnvilStack = await startAnvilStack({ testnetMode: true });
  const relayer: RunningRelayer = await startRelayer({
    rpcUrl: stack.rpcUrl,
    registry: stack.registry,
    privateKey: ANVIL_PRIVATE_KEY,
  });
  const server = generateNodeServerKey();
  await registerNodeViaRelayer(relayer.url, domain, server.nodeKey);

  const demoSession = await registerViaRelayer(relayer.url, demoName);
  await optInViaRelayer(demoSession, demoName, server.nodeKey);

  const credentialId = bytesToHex(crypto.getRandomValues(new Uint8Array(16))) as Hex;
  const mockConfig = {
    oeId: demoOeId,
    credentialId,
    qx: demoSession.passkey.qx,
    qy: demoSession.passkey.qy,
    secretHex: bytesToHex(demoSession.passkey.secretKey) as Hex,
  };

  const dkim = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = dkim.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  const blobs = createBlobStore();
  const index = createMailIndex({
    isOptedIn: (n, nodeKey) => isOptedIn(stack, n, nodeKey),
  });
  const invoices = createMemoryInvoices();

  const node = await startNode({
    domain,
    nodeKey: server.nodeKey,
    nodeSecret: server.secretKey,
    httpPort: port,
    smtpPort: 0,
    bindHost: "127.0.0.1",
    blobs,
    index,
    dataDir: "/tmp/oe-dev-ui",
    signupPrice: "5.00",
    devMode: { mockPasskey: true, mockConfig },
    registry: {
      isOptedIn: (n, nodeKey) => isOptedIn(stack, n, nodeKey),
      nameRecord: async (n) => {
        const [, , dp, wd] = await nameRecordOf(stack, n);
        return { dekPublic: dp, wrappedDek: wd };
      },
      mailboxGeneration: (n) => mailboxGenerationOf(stack, n),
    },
    signup: {
      relayerUrl: relayer.url,
      turnstile: { verify: async (t) => t === "ok" },
      invoices,
      fakeCheckout: true,
      turnstileSiteKey: "",
    },
    send: {
      turnstile: { verify: async (t) => t === "ok" },
      deliver: async () => 250,
      dkim: { selector: "oe1", domain, privateKeyPem },
    },
  });

  await seedMail(node.smtpPort, demoName);

  return {
    node,
    url: node.url,
    mockConfig,
    close: async () => {
      await node.close();
      await relayer.close();
      await stack.stop();
    },
  };
}

async function seedMail(smtpPort: number, _name: string): Promise<void> {
  const samples = [
    { from: "alice@example.com", subject: "Welcome to open-email", body: "Your encrypted mailbox is ready." },
    { from: "noreply@bitoasis.net", subject: "HYPE Is Now Available on BitOasis", body: "Explore HYPE on BitOasis today." },
    { from: "newsletter@proton.me", subject: "Security tips for your mailbox", body: "Keep your recovery secret safe offline." },
    { from: "calendar@service.io", subject: "Meeting tomorrow at 3pm", body: "Reminder: sync at 3pm UTC." },
  ];
  for (const s of samples) {
    const data = [
      `From: ${s.from}`,
      `To: demouser@testnet.crypted.email`,
      `Subject: ${s.subject}`,
      "",
      s.body,
      "",
    ].join("\r\n");
    const sent = await sendSmtp({
      host: "127.0.0.1",
      port: smtpPort,
      from: s.from,
      to: `demouser@testnet.crypted.email`,
      data,
    });
    if (sent.rcptCode !== 250) throw new Error(`seed smtp failed: ${sent.rcptCode}`);
  }
}

const isMain = process.argv[1]?.endsWith("dev-server.ts");
if (isMain) {
  const port = Number(process.env.HTTP_PORT ?? 8787);
  const dev = await startDevServer(port);
  console.log(`Dev UI backend ${dev.url}  demo=${demoOeId}@${domain}`);
  console.log(`Vite: cd node/web && npm run dev  →  http://localhost:5173/?mock=1`);
}
