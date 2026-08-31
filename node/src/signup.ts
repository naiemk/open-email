import type { IncomingMessage, ServerResponse } from "node:http";
import type { Hex } from "viem";

export type SignupInvoice = {
  id: string;
  credentialId: string;
  oeId: string;
  status: "awaiting_payment" | "paid" | "cancelled";
};

export type InvoiceBook = {
  create: (input: { credentialId: string; oeId: string }) => SignupInvoice;
  get: (id: string) => SignupInvoice | undefined;
  markPaid: (id: string) => void;
  retarget: (id: string, oeId: string) => void;
  cancel: (id: string) => void;
};

export type SignupConfig = {
  relayerUrl: string;
  turnstile: { verify: (token: string) => Promise<boolean> };
  invoices: InvoiceBook;
  fakeCheckout?: boolean;
  turnstileSiteKey?: string;
};

type AuthBody = {
  r: Hex;
  s: Hex;
  challengeIndex: number;
  typeIndex: number;
  authenticatorData: Hex;
  clientDataJSON: string;
};

export function createMemoryInvoices(): InvoiceBook {
  const byId = new Map<string, SignupInvoice>();
  const byCred = new Map<string, string>();
  let n = 0;
  return {
    create({ credentialId, oeId }) {
      const open = byCred.get(credentialId);
      if (open) {
        const existing = byId.get(open);
        if (existing && existing.status === "awaiting_payment") {
          existing.oeId = oeId;
          return existing;
        }
      }
      const id = `inv-${++n}`;
      const invoice: SignupInvoice = { id, credentialId, oeId, status: "awaiting_payment" };
      byId.set(id, invoice);
      byCred.set(credentialId, id);
      return invoice;
    },
    get(id) {
      return byId.get(id);
    },
    markPaid(id) {
      const invoice = byId.get(id);
      if (invoice && invoice.status === "awaiting_payment") invoice.status = "paid";
    },
    retarget(id, oeId) {
      const invoice = byId.get(id);
      if (invoice && (invoice.status === "awaiting_payment" || invoice.status === "paid")) {
        invoice.oeId = oeId;
      }
    },
    cancel(id) {
      const invoice = byId.get(id);
      if (invoice && invoice.status === "awaiting_payment") {
        invoice.status = "cancelled";
        if (byCred.get(invoice.credentialId) === id) byCred.delete(invoice.credentialId);
      }
    },
  };
}

export async function handleSignup(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  signup: SignupConfig,
  nodeKey: Hex,
  takeOptSlot?: (name: string) => boolean,
): Promise<boolean> {
  if (!url.pathname.startsWith("/signup/")) return false;

  if (req.method === "POST" && url.pathname === "/signup/invoice") {
    const body = (await readJson(req)) as {
      credentialId?: string;
      oeId?: string;
      turnstile?: string;
    };
    if (!(await signup.turnstile.verify(body.turnstile ?? ""))) {
      json(res, 403, { error: "turnstile" });
      return true;
    }
    const oeId = (body.oeId ?? "").trim();
    const credentialId = (body.credentialId ?? "").trim();
    if (!isOeId(oeId) || !credentialId) {
      json(res, 400, { error: "invalid" });
      return true;
    }
    const invoice = signup.invoices.create({ credentialId, oeId });
    json(res, 200, {
      id: invoice.id,
      status: invoice.status,
      oeId: invoice.oeId,
      payLink: `/pay?id=${invoice.id}`,
    });
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/signup/invoice/")) {
    const id = decodeURIComponent(url.pathname.slice("/signup/invoice/".length));
    const invoice = signup.invoices.get(id);
    if (!invoice) {
      json(res, 404, { error: "unknown invoice" });
      return true;
    }
    json(res, 200, { id: invoice.id, status: invoice.status, oeId: invoice.oeId });
    return true;
  }

  if (req.method === "POST" && url.pathname.startsWith("/signup/invoice/") && url.pathname.endsWith("/cancel")) {
    const id = decodeURIComponent(url.pathname.slice("/signup/invoice/".length, -"/cancel".length));
    const body = (await readJson(req)) as { credentialId?: string };
    const invoice = signup.invoices.get(id);
    if (!invoice || invoice.credentialId !== (body.credentialId ?? "").trim()) {
      json(res, 403, { error: "credential" });
      return true;
    }
    if (invoice.status !== "awaiting_payment") {
      json(res, 400, { error: "cannot cancel" });
      return true;
    }
    signup.invoices.cancel(id);
    json(res, 200, { ok: true });
    return true;
  }

  if (
    req.method === "POST" &&
    signup.fakeCheckout &&
    url.pathname.startsWith("/signup/invoice/") &&
    url.pathname.endsWith("/pay")
  ) {
    const id = decodeURIComponent(url.pathname.slice("/signup/invoice/".length, -"/pay".length));
    const invoice = signup.invoices.get(id);
    if (!invoice || invoice.status !== "awaiting_payment") {
      json(res, 400, { error: "cannot pay" });
      return true;
    }
    signup.invoices.markPaid(id);
    json(res, 200, { id, status: "paid" });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/signup/register") {
    const body = (await readJson(req)) as {
      invoiceId?: string;
      credentialId?: string;
      qx?: Hex;
      qy?: Hex;
      dekPublic?: Hex;
      wrappedDek?: Hex;
      auth?: AuthBody;
    };
    const invoice = paidForCredential(signup, body.invoiceId, body.credentialId);
    if ("error" in invoice) {
      json(res, invoice.status, { error: invoice.error });
      return true;
    }
    const registryName = `${invoice.oeId}.testnet`;
    const registered = await fetch(`${signup.relayerUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: registryName,
        qx: body.qx,
        qy: body.qy,
        dekPublic: body.dekPublic,
        wrappedDek: body.wrappedDek,
        auth: body.auth,
      }),
    });
    if (!registered.ok) {
      json(res, registered.status, await registered.json().catch(() => ({ error: "register failed" })));
      return true;
    }
    json(res, 200, { name: registryName, invoiceId: invoice.id });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/signup/confirm") {
    const body = (await readJson(req)) as { invoiceId?: string; credentialId?: string; auth?: AuthBody };
    const invoice = paidForCredential(signup, body.invoiceId, body.credentialId);
    if ("error" in invoice) {
      json(res, invoice.status, { error: invoice.error });
      return true;
    }
    const registryName = `${invoice.oeId}.testnet`;
    if (takeOptSlot && !takeOptSlot(registryName)) {
      json(res, 429, { error: "rate" });
      return true;
    }
    const opted = await fetch(`${signup.relayerUrl}/opt-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: registryName,
        nodeKey,
        auth: body.auth,
      }),
    });
    if (!opted.ok) {
      json(res, opted.status, await opted.json().catch(() => ({ error: "opt-in failed" })));
      return true;
    }
    json(res, 200, { name: registryName, optedIn: true });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/signup/retarget") {
    const body = (await readJson(req)) as { invoiceId?: string; credentialId?: string; oeId?: string };
    const invoice = signup.invoices.get(body.invoiceId ?? "");
    const oeId = (body.oeId ?? "").trim();
    if (!invoice || invoice.credentialId !== (body.credentialId ?? "").trim()) {
      json(res, 403, { error: "credential" });
      return true;
    }
    if (!isOeId(oeId)) {
      json(res, 400, { error: "invalid" });
      return true;
    }
    if (invoice.status === "cancelled") {
      json(res, 400, { error: "cancelled" });
      return true;
    }
    signup.invoices.retarget(invoice.id, oeId);
    json(res, 200, { id: invoice.id, oeId, status: invoice.status });
    return true;
  }

  return false;
}

const MIN_OE_ID_LENGTH = 5;

function isOeId(oeId: string): boolean {
  return oeId.length >= MIN_OE_ID_LENGTH && !oeId.includes(".");
}

function paidForCredential(
  signup: SignupConfig,
  invoiceId: string | undefined,
  credentialId: string | undefined,
): SignupInvoice | { status: 403 | 402; error: string } {
  const invoice = signup.invoices.get(invoiceId ?? "");
  if (!invoice || invoice.credentialId !== (credentialId ?? "").trim()) {
    return { status: 403, error: "credential" };
  }
  if (invoice.status !== "paid") {
    return { status: 402, error: "unpaid" };
  }
  return invoice;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
