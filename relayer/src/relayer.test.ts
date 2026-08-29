import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes, keccak256, toBytes, zeroHash, type Hex } from "viem";
import { generateDek, wrapDek } from "../../client/src/dek.ts";
import { generatePasskey, signWebAuthn } from "../../client/src/passkey.ts";
import { ANVIL_PRIVATE_KEY, isOptedIn, nameRecordOf, startAnvilStack, type AnvilStack } from "./anvil.ts";
import { startRelayer, type RunningRelayer } from "./server.ts";

const foundryPath = `${process.env.PATH ?? ""}:/home/node/.foundry/bin`;

describe("relayer signup on Anvil", () => {
  let stack: AnvilStack;
  let relayer: RunningRelayer;

  beforeAll(async () => {
    const built = spawnSync("forge", ["build"], {
      cwd: fileURLToPath(new URL("../../registry", import.meta.url)),
      env: { ...process.env, PATH: foundryPath },
      encoding: "utf8",
    });
    if (built.status !== 0) {
      throw new Error(built.stderr || built.stdout || "forge build failed");
    }
    stack = await startAnvilStack();
    relayer = await startRelayer({
      rpcUrl: stack.rpcUrl,
      registry: stack.registry,
      privateKey: ANVIL_PRIVATE_KEY,
    });
  });

  afterAll(async () => {
    await relayer?.close();
    await stack?.stop();
  });

  it("registers a dotless OE id, publishes DEK_public, and opts into a node via passkey", async () => {
    const passkey = generatePasskey();
    const dek = generateDek();
    const kek = new Uint8Array(32).fill(9);
    const wrappedDek = wrapDek(dek.privateKey, kek);
    const dekPublic = bytesToHex(dek.publicKey);
    const wrappedHex = bytesToHex(wrappedDek);

    const dotted = await post("/register", {
      name: "alice.eth",
      qx: passkey.qx,
      qy: passkey.qy,
      dekPublic,
      wrappedDek: wrappedHex,
      auth: emptyAuth(),
    });
    expect(dotted.status).toBe(400);
    expect(await dotted.json()).toEqual({ error: "DottedName" });

    const challengeRes = await fetch(
      `${relayer.url}/register-challenge?name=alice&dekPublic=${dekPublic}&wrappedDek=${wrappedHex}`,
    );
    const { challenge } = (await challengeRes.json()) as { challenge: Hex };
    const registered = await post("/register", {
      name: "alice",
      qx: passkey.qx,
      qy: passkey.qy,
      dekPublic,
      wrappedDek: wrappedHex,
      auth: signWebAuthn(hexToBytes(challenge), passkey.secretKey),
    });
    expect(registered.status).toBe(200);

    const [qx, qy, storedDekPublic, storedWrapped] = await nameRecordOf(stack, "alice");
    expect(qx).toBe(passkey.qx);
    expect(qy).toBe(passkey.qy);
    expect(storedDekPublic).toBe(dekPublic);
    expect(storedWrapped).toBe(wrappedHex);
    expect(storedWrapped).not.toBe(bytesToHex(dek.privateKey));

    const nodeKey = keccak256(toBytes("node-a"));
    expect((await post("/nodes", { nodeKey })).status).toBe(200);

    const forged = await post("/opt-in", { name: "alice", nodeKey, auth: emptyAuth() });
    expect(forged.status).toBe(400);
    expect(await forged.json()).toEqual({ error: "InvalidPasskey" });
    expect(await isOptedIn(stack, "alice", nodeKey)).toBe(false);

    const optChallengeRes = await fetch(
      `${relayer.url}/opt-in-challenge?name=alice&nodeKey=${nodeKey}`,
    );
    const { challenge: optChallenge } = (await optChallengeRes.json()) as { challenge: Hex };
    const opted = await post("/opt-in", {
      name: "alice",
      nodeKey,
      auth: signWebAuthn(hexToBytes(optChallenge), passkey.secretKey),
    });
    expect(opted.status).toBe(200);
    expect(await isOptedIn(stack, "alice", nodeKey)).toBe(true);
  });

  function post(path: string, body: unknown) {
    return fetch(`${relayer.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
});

function emptyAuth() {
  return {
    r: zeroHash,
    s: zeroHash,
    challengeIndex: 0,
    typeIndex: 0,
    authenticatorData: "0x" as Hex,
    clientDataJSON: "",
  };
}
