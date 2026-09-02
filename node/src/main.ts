import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hexToBytes, bytesToHex, type Hex } from "viem";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createMailIndex } from "../../dal/src/indexLog.ts";
import { createDiskBlobStore } from "../../dal/src/storage.ts";
import { loadDotenv } from "../../relayer/src/env.ts";
import { startNode } from "./node.ts";
import { createMemoryInvoices } from "./signup.ts";
import { deliverViaMx } from "./send.ts";
import { createTurnstileVerifier } from "./turnstile.ts";

loadDotenv();

const domain = process.env.DOMAIN ?? "testnet.crypted.email";
const bindHost = process.env.BIND_HOST ?? "0.0.0.0";
const httpPort = Number(process.env.HTTP_PORT ?? 80);
const smtpPort = Number(process.env.SMTP_PORT ?? 25);
const dataDir = process.env.DATA_DIR ?? "/data";
const relayerUrl = (process.env.RELAYER_URL ?? "http://open-email-api:8080").replace(/\/$/, "");
const secretHex = process.env.NODE_SECRET;
if (!secretHex || !/^0x[0-9a-fA-F]{64}$/.test(secretHex)) {
  throw new Error("NODE_SECRET must be a 32-byte hex seed");
}
const nodeSecret = hexToBytes(secretHex as Hex);
const nodeKey = bytesToHex(ed25519.getPublicKey(nodeSecret));

const dkimPem = process.env.DKIM_PRIVATE_KEY
  || (process.env.DKIM_KEY_PATH ? readFileSync(process.env.DKIM_KEY_PATH, "utf8") : "");
if (!dkimPem.includes("PRIVATE KEY")) {
  throw new Error("DKIM_PRIVATE_KEY or DKIM_KEY_PATH must be a PEM private key");
}

const turnstileSecret = process.env.TURNSTILE_SECRET ?? "";
/** Testnet skips Turnstile while debugging; set DISABLE_TURNSTILE=0 to re-enable. */
const disableTurnstile =
  process.env.DISABLE_TURNSTILE === "1" ||
  (domain === "testnet.crypted.email" && process.env.DISABLE_TURNSTILE !== "0");
const turnstileVerify = createTurnstileVerifier(turnstileSecret, disableTurnstile);
const blobs = createDiskBlobStore(join(dataDir, "blobs"));
const index = createMailIndex({
  persistPath: join(dataDir, "index.json"),
  isOptedIn: async (name, key) => {
    const res = await fetch(`${relayerUrl}/opted-in/${encodeURIComponent(name)}/${key}`);
    if (!res.ok) return false;
    const body = (await res.json()) as { optedIn?: boolean };
    return body.optedIn === true;
  },
});

await startNode({
  domain,
  nodeKey,
  nodeSecret,
  bindHost,
  httpPort,
  smtpPort,
  blobs,
  index,
  dataDir,
  signupPrice: process.env.SIGNUP_PRICE ?? "5.00",
  registry: {
    isOptedIn: async (name, key) => {
      const res = await fetch(`${relayerUrl}/opted-in/${encodeURIComponent(name)}/${key}`);
      if (!res.ok) return false;
      return ((await res.json()) as { optedIn?: boolean }).optedIn === true;
    },
    nameRecord: async (name) => {
      const res = await fetch(`${relayerUrl}/names/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error("name record missing");
      const body = (await res.json()) as { dekPublic: Hex; wrappedDek: Hex };
      return { dekPublic: body.dekPublic, wrappedDek: body.wrappedDek };
    },
    mailboxGeneration: async (name) => {
      const res = await fetch(`${relayerUrl}/names/${encodeURIComponent(name)}`);
      if (!res.ok) return 0;
      const body = (await res.json()) as { mailboxGeneration?: number };
      return body.mailboxGeneration ?? 0;
    },
  },
  signup: {
    relayerUrl,
    turnstile: { verify: turnstileVerify },
    invoices: createMemoryInvoices(),
    fakeCheckout: process.env.FAKE_CHECKOUT === "1",
    disableTurnstile,
    turnstileSiteKey: disableTurnstile ? "" : (process.env.TURNSTILE_SITE_KEY ?? ""),
    commerce: process.env.INVOICE_TO
        ? {
            apiUrl: (process.env.COMMERCE_API_URL ?? "https://testnet.trustless-commerce.com").replace(/\/$/, ""),
            invoiceTo: process.env.INVOICE_TO,
            publicUrl: (process.env.PUBLIC_URL ?? `https://${domain}`).replace(/\/$/, ""),
            price: process.env.SIGNUP_PRICE ?? "5.00",
          }
        : undefined,
  },
  send: {
    turnstile: { verify: turnstileVerify },
    deliver: deliverViaMx,
    dkim: {
      selector: "oe1",
      domain,
      privateKeyPem: dkimPem,
    },
  },
});

console.log(`node ${domain} ${bindHost}:${httpPort} smtp :${smtpPort} relayer ${relayerUrl}`);
