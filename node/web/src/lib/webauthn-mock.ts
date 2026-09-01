import { bytesToHex, hexToBytes, type Hex } from "viem";
import { generatePasskey, signWebAuthn } from "@client/passkey.ts";
import type { PasskeyMaterial } from "@/lib/webauthn";

const STORE_KEY = "oe-mock-passkeys";
const MOCK_KEK = new Uint8Array(32).fill(9);

type StoredMock = {
  credentialId: Hex;
  qx: Hex;
  qy: Hex;
  secretHex: Hex;
  oeId: string;
  label: string;
};

function load(): StoredMock[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as StoredMock[];
  } catch {
    return [];
  }
}

function save(list: StoredMock[]) {
  localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 20)));
}

export function seedMockPasskey(input: {
  oeId: string;
  credentialId: Hex;
  qx: Hex;
  qy: Hex;
  secretHex: Hex;
  kek?: Uint8Array;
}): void {
  const list = load().filter((p) => p.credentialId !== input.credentialId);
  list.unshift({
    credentialId: input.credentialId,
    qx: input.qx,
    qy: input.qy,
    secretHex: input.secretHex,
    oeId: input.oeId,
    label: `${input.oeId} (mock)`,
  });
  save(list);
}

function secretOf(credentialId: Hex): Uint8Array {
  const row = load().find((p) => p.credentialId.toLowerCase() === credentialId.toLowerCase());
  if (!row) throw new Error("Mock passkey not found — sign up or use Demo sign in");
  return hexToBytes(row.secretHex);
}

export async function mockCreatePasskey(oeId: string, domain: string): Promise<PasskeyMaterial> {
  const passkey = generatePasskey();
  const credentialId = bytesToHex(crypto.getRandomValues(new Uint8Array(16))) as Hex;
  const secretHex = bytesToHex(passkey.secretKey) as Hex;
  seedMockPasskey({ oeId, credentialId, qx: passkey.qx, qy: passkey.qy, secretHex });
  return { credentialId, qx: passkey.qx, qy: passkey.qy, kek: MOCK_KEK.slice() };
}

export async function mockConnectPasskey(forCredentialId?: Hex): Promise<{ credentialId: Hex; kek: Uint8Array }> {
  const list = load();
  if (list.length === 0) throw new Error("No mock passkeys — sign up or click Demo sign in");
  const row = forCredentialId
    ? list.find((p) => p.credentialId.toLowerCase() === forCredentialId.toLowerCase())
    : list[0];
  if (!row) throw new Error("Mock passkey not found");
  return { credentialId: row.credentialId, kek: MOCK_KEK.slice() };
}

export async function mockAssertWebAuthn(challenge: Hex, credentialId?: Hex): Promise<ReturnType<typeof signWebAuthn>> {
  const id = credentialId ?? load()[0]?.credentialId;
  if (!id) throw new Error("Mock passkey not found");
  return signWebAuthn(hexToBytes(challenge), secretOf(id));
}

export function listMockPasskeys(): StoredMock[] {
  return load();
}
