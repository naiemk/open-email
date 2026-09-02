export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    if (res.status === 413) throw new Error("payload too large");
    throw new Error(`Request failed (${res.status})`);
  }
  let body: T & { error?: string };
  try {
    body = (await res.json()) as T & { error?: string };
  } catch {
    throw new Error(`Request failed (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return body;
}

/** Friendlier message when the node cannot reach the relayer. */
export function relayerHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/relayer unreachable|fetch failed|ECONNREFUSED/i.test(msg)) {
    return "Relayer is down — register needs open-email-api on the node network";
  }
  if (/InvalidPasskey/i.test(msg)) {
    return "Passkey signature rejected on-chain — stored key data may be stale. Sign up again with a fresh passkey.";
  }
  return msg;
}
