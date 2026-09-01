import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "viem";
import { generateDek, unwrapDek, wrapDek } from "../client/src/dek.ts";
import { generatePasskey, signWebAuthn } from "../client/src/passkey.ts";
import { startDevServer, type DevServer } from "./dev-server.ts";

describe("dev UI backend", () => {
  let dev: DevServer;

  beforeAll(async () => {
    dev = await startDevServer(0);
  }, 120_000);

  afterAll(async () => {
    await dev?.close();
  });

  it("advertises mock passkey on /meta", async () => {
    const meta = (await (await fetch(`${dev.url}/meta`)).json()) as { mockPasskey: boolean; fakeCheckout: boolean };
    expect(meta.mockPasskey).toBe(true);
    expect(meta.fakeCheckout).toBe(true);
  });

  it("serves demo mock config", async () => {
    const cfg = (await (await fetch(`${dev.url}/dev/mock-config`)).json()) as { oeId: string; credentialId: string };
    expect(cfg.oeId).toBe("demouser");
    expect(cfg.credentialId).toMatch(/^0x/);
  });

  it("bootstrap returns wrapped DEK for demo mailbox", async () => {
    const cfg = (await (await fetch(`${dev.url}/dev/mock-config`)).json()) as { credentialId: string };
    const boot = (await (await fetch(`${dev.url}/bootstrap/demouser.testnet?credentialId=${cfg.credentialId}`)).json()) as {
      wrappedDek: string;
    };
    expect(boot.wrappedDek).not.toBe("0x");
    const kek = new Uint8Array(32).fill(9);
    expect(unwrapDek(hexToBytes(boot.wrappedDek as `0x${string}`), kek).length).toBe(32);
  });

  it("lists seeded inbox messages for demo", async () => {
    const rows = (await (await fetch(`${dev.url}/index/demouser.testnet`)).json()) as { seq: number }[];
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it("runs signup invoice → pay → register → confirm", async () => {
    const newbiePasskey = generatePasskey();
    const kek = new Uint8Array(32).fill(9);
    const invoice = (await (
      await fetch(`${dev.url}/signup/invoice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentialId: "cred-newbie", oeId: "newbie", turnstile: "ok" }),
      })
    ).json()) as { id: string; payLink: string };

    await fetch(`${dev.url}${invoice.payLink.replace(/^\//, "/")}`);
    await fetch(`${dev.url}/signup/invoice/${invoice.id}/pay`, { method: "POST" });

    const dek = generateDek();
    const wrappedDek = bytesToHex(wrapDek(dek.privateKey, kek));
    const dekPublic = bytesToHex(dek.publicKey);

    const chRes = await fetch(
      `${dev.url}/api/register-challenge?name=newbie.testnet&dekPublic=${dekPublic}&wrappedDek=${wrappedDek}`,
    );
    const { challenge } = (await chRes.json()) as { challenge: `0x${string}` };

    const reg = await fetch(`${dev.url}/signup/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        invoiceId: invoice.id,
        credentialId: "cred-newbie",
        qx: newbiePasskey.qx,
        qy: newbiePasskey.qy,
        dekPublic,
        wrappedDek,
        auth: signWebAuthn(hexToBytes(challenge), newbiePasskey.secretKey),
      }),
    });
    expect(reg.status).toBe(200);
  });
});
