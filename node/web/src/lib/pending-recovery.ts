import type { Hex } from "viem";

const KEY = "open-email/pending-recovery/v1";

export type PendingRecovery = {
  invoiceId: string;
  recovery: string;
  name: string;
  oeId: string;
  credentialId: Hex;
  dekPrivateHex: Hex;
};

export function savePendingRecovery(data: PendingRecovery): void {
  sessionStorage.setItem(KEY, JSON.stringify(data));
}

export function loadPendingRecovery(invoiceId: string): PendingRecovery | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const row = JSON.parse(raw) as PendingRecovery;
    return row.invoiceId === invoiceId ? row : null;
  } catch {
    return null;
  }
}

export function clearPendingRecovery(): void {
  sessionStorage.removeItem(KEY);
}
