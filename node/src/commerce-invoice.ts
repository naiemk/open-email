export type CommerceConfig = {
  apiUrl: string;
  invoiceTo: string;
  publicUrl: string;
  price: string;
};

export type CommerceInvoice = {
  id: string;
  status: string;
  payLink: string;
};

export async function createCommerceInvoice(
  config: CommerceConfig,
  input: { clientInvoiceId: string; title?: string },
): Promise<CommerceInvoice> {
  const callback = `${config.publicUrl.replace(/\/$/, "")}/signup/commerce/webhook`;
  const res = await fetch(`${config.apiUrl.replace(/\/$/, "")}/api/invoices`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": input.clientInvoiceId,
    },
    body: JSON.stringify({
      price: config.price,
      to: config.invoiceTo,
      selectedTo: config.invoiceTo,
      chains: ["11155111"],
      tokens: ["USDC"],
      chainId: "11155111",
      token: "USDC",
      paymentMode: "crypto",
      clientInvoiceId: input.clientInvoiceId,
      title: input.title ?? "open-email mailbox",
      callback,
      successRedirect: `${config.publicUrl.replace(/\/$/, "")}/?signup=${encodeURIComponent(input.clientInvoiceId)}&paid=1`,
    }),
  });
  const body = (await res.json()) as {
    error?: string;
    invoice?: { id: string; status: string };
    payLink?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `commerce invoice failed (${res.status})`);
  const invoice = body.invoice;
  if (!invoice?.id || !body.payLink) throw new Error("commerce invoice missing payLink");
  const base = config.apiUrl.replace(/\/$/, "");
  const payLink = body.payLink.startsWith("http") ? body.payLink : `${base}${body.payLink}`;
  return { id: invoice.id, status: invoice.status, payLink };
}

export async function pollCommerceInvoice(config: CommerceConfig, commerceId: string): Promise<string> {
  const res = await fetch(`${config.apiUrl.replace(/\/$/, "")}/api/invoices/${encodeURIComponent(commerceId)}`);
  if (!res.ok) return "awaiting_payment";
  const body = (await res.json()) as { status?: string };
  return body.status ?? "awaiting_payment";
}

export function commerceStatusPaid(status: string): boolean {
  return status === "paid" || status === "swept" || status === "paid_partial";
}
