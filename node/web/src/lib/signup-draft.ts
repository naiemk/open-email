import type { Hex } from "viem";
import type { SignupState } from "@/App";

const KEY = "open-email/signup-draft/v1";

type StoredDraft = Omit<SignupState, "kek"> & { kekHex: Hex };

export function saveSignupDraft(draft: SignupState): void {
  const stored: StoredDraft = { ...draft, kekHex: bytesToHexLocal(draft.kek) };
  const all = loadAll().filter((d) => d.credentialId !== draft.credentialId);
  all.unshift(stored);
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 5)));
}

export function loadSignupDraft(credentialId: string): SignupState | null {
  const row = loadAll().find((d) => d.credentialId.toLowerCase() === credentialId.toLowerCase());
  if (!row) return null;
  return { ...row, kek: hexToBytesLocal(row.kekHex) };
}

export function loadSignupDraftByInvoice(invoiceId: string): SignupState | null {
  const row = loadAll().find((d) => d.invoiceId === invoiceId);
  if (!row) return null;
  return { ...row, kek: hexToBytesLocal(row.kekHex) };
}

/** Most recent signup draft still awaiting payment or on-chain register. */
export function loadLatestOpenSignupDraft(): SignupState | null {
  const row = loadAll().find((d) => d.status === "paid" || d.status === "awaiting_payment");
  if (!row) return null;
  return { ...row, kek: hexToBytesLocal(row.kekHex) };
}

export function clearSignupDraft(credentialId: string): void {
  localStorage.setItem(
    KEY,
    JSON.stringify(loadAll().filter((d) => d.credentialId.toLowerCase() !== credentialId.toLowerCase())),
  );
}

function loadAll(): StoredDraft[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as StoredDraft[];
  } catch {
    return [];
  }
}

function bytesToHexLocal(bytes: Uint8Array): Hex {
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

function hexToBytesLocal(hex: Hex): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
