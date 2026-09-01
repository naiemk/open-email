import type { Hex } from "viem";

const KEY = "open-email/session/v1";
export const PENDING_OPTIN_KEY = "open-email/pending-optin";

export type SessionData = {
  name: string;
  oeId: string;
  credentialId: Hex;
  dekPrivate: Uint8Array;
  optedIn: boolean;
};

type StoredSession = {
  name: string;
  oeId: string;
  credentialId: Hex;
  dekPrivateHex: Hex;
  optedIn: boolean;
};

export function saveStoredSession(session: SessionData): void {
  const stored: StoredSession = {
    name: session.name,
    oeId: session.oeId,
    credentialId: session.credentialId,
    dekPrivateHex: bytesToHex(session.dekPrivate),
    optedIn: session.optedIn,
  };
  sessionStorage.setItem(KEY, JSON.stringify(stored));
}

export function loadStoredSession(): SessionData | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const row = JSON.parse(raw) as StoredSession;
    return {
      name: row.name,
      oeId: row.oeId,
      credentialId: row.credentialId,
      dekPrivate: hexToBytes(row.dekPrivateHex),
      optedIn: row.optedIn,
    };
  } catch {
    return null;
  }
}

export function clearStoredSession(): void {
  sessionStorage.removeItem(KEY);
  sessionStorage.removeItem(PENDING_OPTIN_KEY);
}

function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

function hexToBytes(hex: Hex): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
