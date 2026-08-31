export type StoredPasskey = {
  credentialId: string;
  oeId: string;
  label: string;
  lastUsed: number;
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
  const list = listPasskeys().filter((p) => p.credentialId !== entry.credentialId);
  list.unshift({ ...entry, lastUsed: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20)));
}

export function touchPasskey(credentialId: string): void {
  const list = listPasskeys();
  const i = list.findIndex((p) => p.credentialId === credentialId);
  if (i >= 0) {
    list[i]!.lastUsed = Date.now();
    localStorage.setItem(KEY, JSON.stringify(list));
  }
}
