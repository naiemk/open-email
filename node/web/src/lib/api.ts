import type { Hex } from "viem";
import { apiJson } from "@/lib/api-fetch";

export type Meta = {
  domain: string;
  nodeKey: Hex;
  fakeCheckout: boolean;
  disableTurnstile?: boolean;
  turnstileSiteKey: string;
  signupPrice: string;
  mockPasskey?: boolean;
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
  return apiJson<Meta>("/meta");
}

export async function createInvoice(input: {
  credentialId: Hex;
  oeId: string;
  turnstile: string;
  qx?: Hex;
  qy?: Hex;
}): Promise<{ id: string; payLink: string; status: string; qx?: Hex; qy?: Hex }> {
  return apiJson("/signup/invoice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function pollInvoice(id: string): Promise<string> {
  const body = await apiJson<{ status: string }>(`/signup/invoice/${id}`);
  return body.status;
}

export async function fetchOpenSignup(credentialId: Hex): Promise<{
  id: string;
  payLink: string;
  status: string;
  oeId: string;
  qx?: Hex;
  qy?: Hex;
} | null> {
  const res = await fetch(`/signup/open?credentialId=${encodeURIComponent(credentialId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as {
    id: string;
    payLink: string;
    status: string;
    oeId: string;
    qx?: Hex;
    qy?: Hex;
  };
}

export async function markInvoicePaid(id: string): Promise<void> {
  await apiJson(`/signup/invoice/${id}/pay`, { method: "POST" });
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
  return apiJson("/signup/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function confirmSaved(input: { invoiceId: string; credentialId: Hex; auth: unknown }): Promise<void> {
  await apiJson("/signup/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function registerChallenge(name: string, dekPublic: Hex, wrappedDek: Hex): Promise<Hex> {
  const body = await apiJson<{ challenge: Hex }>(
    `/api/register-challenge?name=${encodeURIComponent(name)}&dekPublic=${dekPublic}&wrappedDek=${wrappedDek}`,
  );
  if (!body.challenge) throw new Error("Register challenge unavailable — is the relayer running?");
  return body.challenge;
}

export async function optInChallenge(name: string, nodeKey: Hex): Promise<Hex> {
  const body = await apiJson<{ challenge: Hex }>(
    `/api/opt-in-challenge?name=${encodeURIComponent(name)}&nodeKey=${nodeKey}`,
  );
  if (!body.challenge) throw new Error("Opt-in challenge unavailable — is the relayer running?");
  return body.challenge;
}

export async function bootstrap(name: string, credentialId?: Hex): Promise<{ wrappedDek: Hex }> {
  const q = credentialId ? `?credentialId=${encodeURIComponent(credentialId)}` : "";
  const body = await apiJson<{ wrappedDek?: Hex; error?: string }>(`/bootstrap/${encodeURIComponent(name)}${q}`);
  const wrap = body.wrappedDek;
  if (!wrap || wrap === "0x") {
    throw new Error("Mailbox not registered yet — sign up first or check your OE id");
  }
  return { wrappedDek: wrap };
}

export async function optedIn(name: string, nodeKey: Hex): Promise<boolean> {
  const body = await apiJson<{ optedIn: boolean }>(`/api/opted-in/${encodeURIComponent(name)}/${nodeKey}`);
  return body.optedIn === true;
}

export async function fetchName(name: string): Promise<{
  exists: boolean;
  qx: Hex;
  qy: Hex;
  dekPublic: Hex;
  wrappedDek: Hex;
}> {
  return apiJson(`/api/names/${encodeURIComponent(name)}`);
}

export async function fetchNode(nodeKey: Hex): Promise<{ domain: string; nodeKey: Hex }> {
  return apiJson(`/api/nodes/${encodeURIComponent(nodeKey)}`);
}

export async function fetchInviteUsed(inviteId: Hex): Promise<boolean> {
  const body = await apiJson<{ used: boolean }>(`/api/invite-used/${encodeURIComponent(inviteId)}`);
  return body.used === true;
}

export async function linkChallenge(
  name: string,
  nodeKey: Hex,
  newQx: Hex,
  newQy: Hex,
  inviteId: Hex,
): Promise<Hex> {
  const body = await apiJson<{ challenge: Hex }>(
    `/api/link-challenge?name=${encodeURIComponent(name)}&nodeKey=${nodeKey}&newQx=${newQx}&newQy=${newQy}&inviteId=${inviteId}`,
  );
  if (!body.challenge) throw new Error("Link challenge unavailable");
  return body.challenge;
}

export async function submitLink(input: {
  name: string;
  nodeKey: Hex;
  newQx: Hex;
  newQy: Hex;
  inviteId: Hex;
  auth: unknown;
}): Promise<void> {
  await apiJson("/api/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function removeControllerChallenge(name: string, qx: Hex, qy: Hex): Promise<Hex> {
  const body = await apiJson<{ challenge: Hex }>(
    `/api/remove-controller-challenge?name=${encodeURIComponent(name)}&qx=${qx}&qy=${qy}`,
  );
  if (!body.challenge) throw new Error("Remove-controller challenge unavailable");
  return body.challenge;
}

export async function submitRemoveController(input: {
  name: string;
  qx: Hex;
  qy: Hex;
  auth: unknown;
}): Promise<void> {
  await apiJson("/api/remove-controller", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function signServiceInvite(input: {
  name: string;
  qx: Hex;
  qy: Hex;
  guestPub: Hex;
}): Promise<{ invite: unknown; blob: string }> {
  return apiJson("/pair/invite-sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function storeServiceWrap(input: {
  name: string;
  credentialId: Hex;
  wrappedDek: Hex;
}): Promise<void> {
  await apiJson("/pair/service-wrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type MockConfig = {
  oeId: string;
  credentialId: Hex;
  qx: Hex;
  qy: Hex;
  secretHex: Hex;
};

export async function fetchMockConfig(): Promise<MockConfig | null> {
  const res = await fetch("/dev/mock-config");
  if (!res.ok) return null;
  return (await res.json()) as MockConfig;
}
