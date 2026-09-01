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
