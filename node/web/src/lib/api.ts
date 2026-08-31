import type { Hex } from "viem";

export type Meta = {
  domain: string;
  nodeKey: Hex;
  fakeCheckout: boolean;
  turnstileSiteKey: string;
  signupPrice: string;
};

export type SignupDraft = {
  oeId: string;
  credentialId: Hex;
  qx: Hex;
  qy: Hex;
  invoiceId: string;
  payLink: string;
  status: string;
};

export async function fetchMeta(): Promise<Meta> {
  return (await fetch("/meta")).json() as Promise<Meta>;
}

export async function createInvoice(input: {
  credentialId: Hex;
  oeId: string;
  turnstile: string;
}): Promise<{ id: string; payLink: string; status: string }> {
  const res = await fetch("/signup/invoice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as { error?: string; id: string; payLink: string; status: string };
  if (!res.ok) throw new Error(body.error ?? "invoice failed");
  return body;
}

export async function pollInvoice(id: string): Promise<string> {
  const body = (await (await fetch(`/signup/invoice/${id}`)).json()) as { status: string };
  return body.status;
}

export async function registerPaid(input: {
  invoiceId: string;
  credentialId: Hex;
  qx: Hex;
  qy: Hex;
  dekPublic: Hex;
  wrappedDek: Hex;
  auth: unknown;
}): Promise<{ name: string }> {
  const res = await fetch("/signup/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "register failed");
  return (await res.json()) as { name: string };
}

export async function confirmSaved(input: { invoiceId: string; credentialId: Hex; auth: unknown }): Promise<void> {
  const res = await fetch("/signup/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "confirm failed");
}

export async function registerChallenge(name: string, dekPublic: Hex, wrappedDek: Hex): Promise<Hex> {
  const res = await fetch(
    `/api/register-challenge?name=${encodeURIComponent(name)}&dekPublic=${dekPublic}&wrappedDek=${wrappedDek}`,
  );
  return ((await res.json()) as { challenge: Hex }).challenge;
}

export async function optInChallenge(name: string, nodeKey: Hex): Promise<Hex> {
  const res = await fetch(`/api/opt-in-challenge?name=${encodeURIComponent(name)}&nodeKey=${nodeKey}`);
  return ((await res.json()) as { challenge: Hex }).challenge;
}

export async function bootstrap(name: string, credentialId?: Hex): Promise<{ wrappedDek: Hex }> {
  const q = credentialId ? `?credentialId=${encodeURIComponent(credentialId)}` : "";
  return (await (await fetch(`/bootstrap/${encodeURIComponent(name)}${q}`)).json()) as { wrappedDek: Hex };
}

export async function optedIn(name: string, nodeKey: Hex): Promise<boolean> {
  const body = (await (await fetch(`/api/opted-in/${encodeURIComponent(name)}/${nodeKey}`)).json()) as {
    optedIn: boolean;
  };
  return body.optedIn;
}
