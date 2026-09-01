export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
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
  return msg;
}
