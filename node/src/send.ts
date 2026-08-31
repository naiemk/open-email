import { resolveMx } from "node:dns/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Hex } from "viem";
import { signDkim, type DkimKey } from "./dkim.ts";
import { sendSmtp } from "./smtpSend.ts";

export type SendConfig = {
  turnstile: { verify: (token: string) => Promise<boolean> };
  deliver: (mail: { mailFrom: string; rcptTo: string; data: string }) => Promise<number>;
  dkim: DkimKey;
  now?: () => number;
};

export async function deliverViaMx(mail: { mailFrom: string; rcptTo: string; data: string }): Promise<number> {
  const host = mail.rcptTo.split("@")[1];
  if (!host) return 550;
  const mx = (await resolveMx(host).catch(() => [])).sort((a, b) => a.priority - b.priority);
  const target = mx[0]?.exchange ?? host;
  const result = await sendSmtp({
    host: target,
    port: 25,
    from: mail.mailFrom,
    to: mail.rcptTo,
    data: mail.data,
  });
  return result.dataCode || result.rcptCode;
}

export function smtpFromAddress(domain: string, name: string): string {
  if (domain.toLowerCase() === "testnet.crypted.email" && name.endsWith(".testnet")) {
    return `${name.slice(0, -".testnet".length)}@${domain}`;
  }
  return `${name}@${domain}`;
}

export function buildSignedMessage(input: {
  mailFrom: string;
  to: string;
  subject: string;
  body: string;
  dkim: DkimKey;
  t?: number;
}): string {
  const rfc5322 = [
    `From: ${input.mailFrom}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "",
    input.body,
    "",
  ].join("\r\n");
  return signDkim(rfc5322, input.dkim, input.t);
}

export async function handleSend(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  opts: {
    domain: string;
    nodeKey: Hex;
    send: SendConfig;
    isOptedIn: (name: string, nodeKey: Hex) => Promise<boolean>;
    takeSendSlot: (name: string) => boolean;
    ingest: (name: string, rfc5322: Uint8Array, direction: "in" | "out") => Promise<void>;
  },
): Promise<boolean> {
  if (req.method !== "POST" || url.pathname !== "/send") return false;
  const body = (await readJson(req)) as {
    name?: string;
    to?: string;
    subject?: string;
    body?: string;
    turnstile?: string;
  };
  if (!(await opts.send.turnstile.verify(body.turnstile ?? ""))) {
    json(res, 403, { error: "turnstile" });
    return true;
  }
  const name = (body.name ?? "").trim();
  const to = (body.to ?? "").trim();
  if (!name || !to || !to.includes("@")) {
    json(res, 400, { error: "invalid" });
    return true;
  }
  if (!(await opts.isOptedIn(name, opts.nodeKey))) {
    json(res, 403, { error: "not opted in" });
    return true;
  }
  if (!opts.takeSendSlot(name)) {
    json(res, 429, { error: "rate" });
    return true;
  }
  const mailFrom = smtpFromAddress(opts.domain, name);
  const data = buildSignedMessage({
    mailFrom,
    to,
    subject: body.subject ?? "",
    body: body.body ?? "",
    dkim: opts.send.dkim,
    t: Math.floor((opts.send.now?.() ?? Date.now()) / 1000),
  });
  const bytes = new TextEncoder().encode(data);
  try {
    await opts.ingest(name, bytes, "out");
  } catch (err) {
    const code = err instanceof Error && "responseCode" in err ? Number((err as { responseCode: number }).responseCode) : 500;
    json(res, code === 452 ? 452 : 500, { error: "storage" });
    return true;
  }
  const delivered = await opts.send.deliver({ mailFrom, rcptTo: to, data });
  if (delivered >= 400) {
    json(res, 500, { error: "delivery" });
    return true;
  }
  json(res, 200, { ok: true });
  return true;
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
