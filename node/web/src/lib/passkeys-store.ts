import type { Hex } from "viem";

export type StoredPasskey = {
  credentialId: string;
  oeId: string;
  label: string;
  lastUsed: number;
  /** Passkey P-256 coords — needed to finish register after unpaid signup. */
  qx?: Hex;
  qy?: Hex;
};

const KEY = "open-email/passkeys/v1";

export function listPasskeys(): StoredPasskey[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as StoredPasskey[];
  } catch {
    return [];
  }
}

export function rememberPasskey(entry: StoredPasskey): void {
  const list = listPasskeys().filter(
    (p) => p.credentialId.toLowerCase() !== entry.credentialId.toLowerCase(),
  );
  list.unshift({ ...entry, lastUsed: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20)));
}

export function touchPasskey(credentialId: string): void {
  const list = listPasskeys();
  const i = list.findIndex((p) => p.credentialId.toLowerCase() === credentialId.toLowerCase());
  if (i >= 0) {
    list[i]!.lastUsed = Date.now();
    localStorage.setItem(KEY, JSON.stringify(list));
  }
}

export function findPasskey(credentialId: string): StoredPasskey | undefined {
  return listPasskeys().find((p) => p.credentialId.toLowerCase() === credentialId.toLowerCase());
}

export function removePasskey(credentialId: string): void {
  localStorage.setItem(
    KEY,
    JSON.stringify(listPasskeys().filter((p) => p.credentialId.toLowerCase() !== credentialId.toLowerCase())),
  );
}
