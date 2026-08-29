import { bytesToHex, hexToBytes, type Hex } from "viem";
import { generateDek, wrapDek, type Dek } from "../../client/src/dek.ts";
import { generatePasskey, signWebAuthn, type Passkey } from "../../client/src/passkey.ts";

export type RelayerSession = {
  url: string;
  passkey: Passkey;
  dek: Dek;
  kek: Uint8Array;
  dekPublic: Hex;
  wrappedDek: Hex;
};

export async function registerViaRelayer(
  url: string,
  name: string,
): Promise<RelayerSession> {
  const passkey = generatePasskey();
  const dek = generateDek();
  const kek = new Uint8Array(32).fill(9);
  const wrappedDek = bytesToHex(wrapDek(dek.privateKey, kek));
  const dekPublic = bytesToHex(dek.publicKey);
  const challengeRes = await fetch(
    `${url}/register-challenge?name=${name}&dekPublic=${dekPublic}&wrappedDek=${wrappedDek}`,
  );
  const { challenge } = (await challengeRes.json()) as { challenge: Hex };
  const registered = await fetch(`${url}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      qx: passkey.qx,
      qy: passkey.qy,
      dekPublic,
      wrappedDek,
      auth: signWebAuthn(hexToBytes(challenge), passkey.secretKey),
    }),
  });
  if (!registered.ok) throw new Error(await registered.text());
  return { url, passkey, dek, kek, dekPublic, wrappedDek };
}

export async function registerNodeViaRelayer(url: string, domain: string, masterKey: Hex): Promise<void> {
  const res = await fetch(`${url}/nodes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain, masterKey }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function optInViaRelayer(session: RelayerSession, name: string, nodeKey: Hex): Promise<void> {
  const challengeRes = await fetch(`${session.url}/opt-in-challenge?name=${name}&nodeKey=${nodeKey}`);
  const { challenge } = (await challengeRes.json()) as { challenge: Hex };
  const res = await fetch(`${session.url}/opt-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      nodeKey,
      auth: signWebAuthn(hexToBytes(challenge), session.passkey.secretKey),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function optOutViaRelayer(session: RelayerSession, name: string, nodeKey: Hex): Promise<void> {
  const challengeRes = await fetch(`${session.url}/opt-out-challenge?name=${name}&nodeKey=${nodeKey}`);
  const { challenge } = (await challengeRes.json()) as { challenge: Hex };
  const res = await fetch(`${session.url}/opt-out`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      nodeKey,
      auth: signWebAuthn(hexToBytes(challenge), session.passkey.secretKey),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
}
