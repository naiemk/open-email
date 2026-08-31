import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { generateDek, unwrapDek, wrapDek } from "../../client/src/dek.ts";
import { generatePasskey, signWebAuthn } from "../../client/src/passkey.ts";
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
import { registerNodeViaRelayer } from "../../relayer/src/ops.ts";
import { startRelayer, type RunningRelayer } from "../../relayer/src/server.ts";
import { generateNodeServerKey } from "./keys.ts";
import { startNode, type RunningNode } from "./node.ts";
import { createMemoryInvoices } from "./signup.ts";

const domain = "testnet.crypted.email";
const name = "alice.testnet";

describe("paid signup through the node", () => {
  let stack: AnvilStack;
  let relayer: RunningRelayer;
  let nodeA: RunningNode;
  const invoices = createMemoryInvoices();
  const server = generateNodeServerKey();

  beforeAll(async () => {
    ensureRegistryBuilt();
    stack = await startAnvilStack({ testnetMode: true });
    relayer = await startRelayer({
      rpcUrl: stack.rpcUrl,
      registry: stack.registry,
      privateKey: ANVIL_PRIVATE_KEY,
    });
    await registerNodeViaRelayer(relayer.url, domain, server.nodeKey);

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
      },
      signup: {
        relayerUrl: relayer.url,
        turnstile: { verify: async (token) => token === "ok" },
        invoices,
        fakeCheckout: true,
      },
    });
  });

  afterAll(async () => {
    await nodeA?.close();
    await relayer?.close();
    await stack?.stop();
  });

  it("serves a signup shell with an OE id field, not a fake inbox", async () => {
    const html = await (await fetch(nodeA.url + "/")).text();
    expect(html).toContain('data-act="oeId"');
    expect(html).toContain("OE id");
    expect(html).not.toContain(">Inbox<");
  });

  it("advertises checkout mode on /meta", async () => {
    const meta = (await (await fetch(`${nodeA.url}/meta`)).json()) as {
      domain: string;
      fakeCheckout: boolean;
      turnstileSiteKey: string;
    };
    expect(meta.domain).toBe(domain);
    expect(meta.fakeCheckout).toBe(true);
    expect(meta.turnstileSiteKey).toBe("");
  });

  it("rejects a short or dotted OE id before invoice", async () => {
    const short = await fetch(`${nodeA.url}/signup/invoice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: "cred-short", oeId: "bob", turnstile: "ok" }),
    });
    expect(short.status).toBe(400);
    const dotted = await fetch(`${nodeA.url}/signup/invoice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: "cred-dot", oeId: "alice.eth", turnstile: "ok" }),
    });
    expect(dotted.status).toBe(400);
  });

  it("does not create an invoice without Turnstile", async () => {
    const res = await fetch(`${nodeA.url}/signup/invoice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: "cred-1", oeId: "alice", turnstile: "nope" }),
    });
    expect(res.status).toBe(403);
    expect(await nameRecordOf(stack, name)).toEqual([
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      "0x",
      "0x",
    ]);
  });

  it("registers after paid invoice, shows a client recovery wrap, then auto opt-in on confirm", async () => {
    const created = await fetch(`${nodeA.url}/signup/invoice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: "cred-alice", oeId: "alice", turnstile: "ok" }),
    });
    expect(created.status).toBe(200);
    const invoice = (await created.json()) as { id: string; status: string; oeId: string; payLink: string };
    expect(invoice.status).toBe("awaiting_payment");
    expect(invoice.oeId).toBe("alice");
    expect(invoice.payLink).toBe(`/pay?id=${invoice.id}`);

    const unpaid = await registerOnNode("alice.testnet", invoice.id, "cred-alice");
    expect(unpaid.status).toBe(402);

    invoices.markPaid(invoice.id);
    const polled = await (await fetch(`${nodeA.url}/signup/invoice/${invoice.id}`)).json() as { status: string };
    expect(polled.status).toBe("paid");

    const passkey = generatePasskey();
    const dek = generateDek();
    const kek = new Uint8Array(32).fill(9);
    const wrappedDek = bytesToHex(wrapDek(dek.privateKey, kek));
    const dekPublic = bytesToHex(dek.publicKey);
    const recoveryKek = new Uint8Array(32).fill(3);
    const recoveryWrap = wrapDek(dek.privateKey, recoveryKek);
    expect(unwrapDek(recoveryWrap, recoveryKek)).toEqual(dek.privateKey);

    const paid = await registerOnNode(name, invoice.id, "cred-alice", passkey, dekPublic, wrappedDek);
    expect(paid.status).toBe(200);
    expect(await paid.json()).toEqual({ name, invoiceId: invoice.id });
    const [, , storedDek] = await nameRecordOf(stack, name);
    expect(storedDek).toBe(dekPublic);
    expect(await isOptedIn(stack, name, server.nodeKey)).toBe(false);

    const confirm = await confirmOnNode(name, invoice.id, "cred-alice", passkey);
    expect(confirm.status).toBe(200);
    expect(await isOptedIn(stack, name, server.nodeKey)).toBe(true);
  });

  it("lets a paid collision retarget the OE id on the same invoice", async () => {
    const created = await fetch(`${nodeA.url}/signup/invoice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: "cred-collide", oeId: "alice", turnstile: "ok" }),
    });
    const invoice = (await created.json()) as { id: string };
    invoices.markPaid(invoice.id);
    const passkey = generatePasskey();
    const dek = generateDek();
    const wrappedDek = bytesToHex(wrapDek(dek.privateKey, new Uint8Array(32).fill(1)));
    const dekPublic = bytesToHex(dek.publicKey);
    const taken = await registerOnNode("alice.testnet", invoice.id, "cred-collide", passkey, dekPublic, wrappedDek);
    expect(taken.status).toBe(400);
    expect(await taken.json()).toEqual({ error: "NameTaken" });

    const retarget = await fetch(`${nodeA.url}/signup/retarget`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invoiceId: invoice.id, credentialId: "cred-collide", oeId: "alicia" }),
    });
    expect(retarget.status).toBe(200);
    const retry = await registerOnNode("alicia.testnet", invoice.id, "cred-collide", passkey, dekPublic, wrappedDek);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ name: "alicia.testnet", invoiceId: invoice.id });
  });

  it("does not lock an unpaid OE id and retargets before pay", async () => {
    const first = await fetch(`${nodeA.url}/signup/invoice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: "cred-lock-a", oeId: "share", turnstile: "ok" }),
    });
    const second = await fetch(`${nodeA.url}/signup/invoice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: "cred-lock-b", oeId: "share", turnstile: "ok" }),
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = (await first.json()) as { id: string };
    const b = (await second.json()) as { id: string };
    expect(b.id).not.toBe(a.id);

    const retarget = await fetch(`${nodeA.url}/signup/retarget`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invoiceId: a.id, credentialId: "cred-lock-a", oeId: "shared" }),
    });
    expect(retarget.status).toBe(200);
    const polled = (await (await fetch(`${nodeA.url}/signup/invoice/${a.id}`)).json()) as { oeId: string };
    expect(polled.oeId).toBe("shared");
  });

  it("resumes an unpaid invoice and cancels only while unpaid", async () => {
    const first = await fetch(`${nodeA.url}/signup/invoice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: "cred-resume", oeId: "resume", turnstile: "ok" }),
    });
    expect(first.status).toBe(200);
    const a = (await first.json()) as { id: string };
    const again = await fetch(`${nodeA.url}/signup/invoice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: "cred-resume", oeId: "resumed", turnstile: "ok" }),
    });
    expect(again.status).toBe(200);
    const b = (await again.json()) as { id: string; oeId: string };
    expect(b.id).toBe(a.id);
    expect(b.oeId).toBe("resumed");

    const cancelled = await fetch(`${nodeA.url}/signup/invoice/${a.id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: "cred-resume" }),
    });
    expect(cancelled.status).toBe(200);
    invoices.markPaid(a.id);
    const afterCancel = await registerOnNode("resumed.testnet", a.id, "cred-resume");
    expect(afterCancel.status).toBe(402);

    const fresh = await fetch(`${nodeA.url}/signup/invoice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: "cred-resume", oeId: "freshy", turnstile: "ok" }),
    });
    expect(fresh.status).toBe(200);
    const c = (await fresh.json()) as { id: string };
    expect(c.id).not.toBe(a.id);
  });

  it("hosts fake checkout and same-origin relayer challenges, not /nodes", async () => {
    const created = await fetch(`${nodeA.url}/signup/invoice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: "cred-pay", oeId: "payer", turnstile: "ok" }),
    });
    const invoice = (await created.json()) as { id: string; payLink: string };
    const payPage = await fetch(`${nodeA.url}${invoice.payLink}`);
    expect(payPage.status).toBe(200);
    expect(await payPage.text()).toContain("Mark paid");
    expect((await fetch(`${nodeA.url}/signup/invoice/${invoice.id}/pay`, { method: "POST" })).status).toBe(200);
    const polled = (await (await fetch(`${nodeA.url}/signup/invoice/${invoice.id}`)).json()) as { status: string };
    expect(polled.status).toBe("paid");

    const dek = generateDek();
    const wrapped = bytesToHex(wrapDek(dek.privateKey, new Uint8Array(32).fill(4)));
    const pub = bytesToHex(dek.publicKey);
    const challenge = await fetch(
      `${nodeA.url}/api/register-challenge?name=payer.testnet&dekPublic=${pub}&wrappedDek=${wrapped}`,
    );
    expect(challenge.status).toBe(200);
    expect(((await challenge.json()) as { challenge: string }).challenge).toMatch(/^0x/);
    expect((await fetch(`${nodeA.url}/api/nodes`)).status).toBe(404);
  });

  async function registerOnNode(
    registryName: string,
    invoiceId: string,
    credentialId: string,
    passkey = generatePasskey(),
    dekPublic?: Hex,
    wrappedDek?: Hex,
  ) {
    const dek = generateDek();
    const pub = dekPublic ?? bytesToHex(dek.publicKey);
    const wrap = wrappedDek ?? bytesToHex(wrapDek(dek.privateKey, new Uint8Array(32).fill(2)));
    const challengeRes = await fetch(
      `${relayer.url}/register-challenge?name=${registryName}&dekPublic=${pub}&wrappedDek=${wrap}`,
    );
    const { challenge } = (await challengeRes.json()) as { challenge: Hex };
    return fetch(`${nodeA.url}/signup/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        invoiceId,
        credentialId,
        qx: passkey.qx,
        qy: passkey.qy,
        dekPublic: pub,
        wrappedDek: wrap,
        auth: signWebAuthn(hexToBytes(challenge), passkey.secretKey),
      }),
    });
  }

  async function confirmOnNode(
    registryName: string,
    invoiceId: string,
    credentialId: string,
    passkey: ReturnType<typeof generatePasskey>,
  ) {
    const challengeRes = await fetch(
      `${relayer.url}/opt-in-challenge?name=${registryName}&nodeKey=${server.nodeKey}`,
    );
    const { challenge } = (await challengeRes.json()) as { challenge: Hex };
    return fetch(`${nodeA.url}/signup/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        invoiceId,
        credentialId,
        auth: signWebAuthn(hexToBytes(challenge), passkey.secretKey),
      }),
    });
  }
});
