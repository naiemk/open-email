import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bytesToHex } from "viem";
import { generateDek, wrapDek } from "../../client/src/dek.ts";
import { createCredentialWrapStore } from "./credential-wraps.ts";
import { createPairStore, handlePair } from "./pair.ts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

describe("device pairing", () => {
  let url: string;
  let close: () => Promise<void>;
  const pair = createPairStore(() => 1_000_000);
  const wraps = createCredentialWrapStore();

  beforeAll(async () => {
    const server = createServer((req, res) => {
      void (async () => {
        const u = new URL(req.url ?? "/", "http://127.0.0.1");
        if (await handlePair(req, u, res, pair, wraps)) return;
        json(res, 404, { error: "not found" });
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    url = `http://127.0.0.1:${addr.port}`;
    close = () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  afterAll(async () => {
    await close();
  });

  it("hands a DEK wrap to a new credential via a pairing session", async () => {
    const created = await fetch(`${url}/pair/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alice.testnet", hostCredentialId: "0xhost" }),
    });
    const { sid } = (await created.json()) as { sid: string };
    expect(sid).toMatch(/^pair-/);

    const dek = generateDek();
    const guest = generateDek();
    const guestPub = bytesToHex(guest.publicKey);
    const join = await fetch(`${url}/pair/sessions/${sid}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guestPub }),
    });
    expect(join.status).toBe(200);

    const sealed = "0x" + "ab".repeat(64);
    const grant = await fetch(`${url}/pair/sessions/${sid}/grant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostCredentialId: "0xhost", sealedDek: sealed }),
    });
    expect(grant.status).toBe(200);

    const wrappedDek = bytesToHex(wrapDek(dek.privateKey, new Uint8Array(32).fill(9)));
    const finish = await fetch(`${url}/pair/sessions/${sid}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: "0xguest", wrappedDek }),
    });
    expect(finish.status).toBe(200);

    const stored = wraps.get("0xguest");
    expect(stored?.name).toBe("alice.testnet");
    expect(stored?.wrappedDek).toBe(wrappedDek);
  });
});

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
