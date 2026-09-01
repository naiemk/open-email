import PostalMime from "postal-mime";
import { openEnvelope } from "@client/envelope.ts";
import { apiJson } from "@/lib/api-fetch";

export type MailAttachment = {
  partId: string;
  filename: string;
  mimeType: string;
  size: number;
  content: Uint8Array;
};

export type IndexRow = {
  seq: number;
  cid: string;
  direction: "in" | "out";
  trashed: boolean;
  read: boolean;
  starred: boolean;
  archived: boolean;
  spam: boolean;
  labels: string[];
  snoozeUntil?: number;
  time: number;
};

export type Mail = IndexRow & {
  from: string;
  to: string;
  subject: string;
  body: string;
  rawRfc822: string;
  htmlBody?: string;
  attachments: MailAttachment[];
};

export type ComposeAttachment = {
  filename: string;
  mimeType: string;
  contentBase64: string;
};

export async function fetchIndex(name: string, before?: number): Promise<IndexRow[]> {
  const q = before ? `?before=${before}` : "";
  return apiJson<IndexRow[]>(`/index/${encodeURIComponent(name)}${q}`);
}

export async function fetchLabels(name: string): Promise<string[]> {
  const res = await apiJson<{ labels: string[] }>(`/mail-labels/${encodeURIComponent(name)}`);
  return res.labels;
}

export async function patchMailState(
  name: string,
  updates: Array<{
    seq: number;
    read?: boolean;
    starred?: boolean;
    archived?: boolean;
    spam?: boolean;
    trashed?: boolean;
    labels?: string[];
    snoozeUntil?: number | null;
  }>,
): Promise<void> {
  await fetch(`/mail-state/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      updates: updates.map((u) => ({
        ...u,
        snoozeUntil: u.snoozeUntil === null ? undefined : u.snoozeUntil,
      })),
    }),
  });
}

export async function restoreMail(name: string, seq: number): Promise<void> {
  await fetch(`/restore/${encodeURIComponent(name)}/${seq}`, { method: "POST" });
}

export async function fetchBlob(name: string, cid: string): Promise<Uint8Array> {
  const res = await fetch(`/blobs/${encodeURIComponent(cid)}?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Blob ${cid} not found`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function decryptRows(name: string, rows: IndexRow[], dekPrivate: Uint8Array): Promise<Mail[]> {
  const mails: Mail[] = [];
  for (const row of rows) {
    try {
      const blob = await fetchBlob(name, row.cid);
      const rawRfc822 = new TextDecoder().decode(await openEnvelope(dekPrivate, name, blob));
      mails.push({ ...row, ...(await parseRfc822(rawRfc822)) });
    } catch {
      mails.push({
        ...row,
        from: "(decrypt failed)",
        to: "",
        subject: `Message #${row.seq}`,
        body: "Could not decrypt this message.",
        rawRfc822: "",
        attachments: [],
      });
    }
  }
  return mails;
}

export async function parseRfc822(rawRfc822: string): Promise<{
  from: string;
  to: string;
  subject: string;
  body: string;
  rawRfc822: string;
  htmlBody?: string;
  attachments: MailAttachment[];
}> {
  const parsed = await PostalMime.parse(rawRfc822);
  const attachments: MailAttachment[] = (parsed.attachments ?? [])
    .filter((att) => !att.mimeType?.toLowerCase().startsWith("text/html"))
    .map((att, i) => ({
    partId: String(i),
    filename: att.filename || att.mimeType || `attachment-${i + 1}`,
    mimeType: att.mimeType || "application/octet-stream",
    size: att.content?.byteLength ?? 0,
    content: att.content instanceof Uint8Array ? att.content : new Uint8Array(att.content ?? []),
  }));
  return {
    from: parsed.from?.address ? formatAddress(parsed.from) : String(parsed.from ?? ""),
    to: (parsed.to ?? []).map(formatAddress).join(", "),
    subject: parsed.subject ?? "",
    body: parsed.text ?? "",
    rawRfc822,
    htmlBody: parsed.html || undefined,
    attachments,
  };
}

function formatAddress(addr: { name?: string; address?: string } | string): string {
  if (typeof addr === "string") return addr;
  if (addr.name && addr.address) return `${addr.name} <${addr.address}>`;
  return addr.address ?? "";
}

export function hasHtmlBody(mail: Pick<Mail, "htmlBody">): boolean {
  return Boolean(mail.htmlBody?.trim());
}

/** Wrap partial HTML fragments in a document that fills the reader width. */
export function wrapHtmlForView(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>
html,body{margin:0;padding:16px;width:100%;box-sizing:border-box;background:#fff;color:#111;}
body{min-height:100%;}
img{max-width:100%!important;height:auto!important;}
table{max-width:100%!important;}
</style></head><body>${html}</body></html>`;
}

export function smtpFrom(domain: string, name: string): string {
  const oeId = name.endsWith(".testnet") ? name.slice(0, -".testnet".length) : name;
  return `${oeId}@${domain}`;
}

export function formatMailDate(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function formatMailWeekday(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { weekday: "long" });
}

export function senderInitial(from: string): string {
  const name = from.replace(/^.*<([^>]+)>.*$/, "$1").split("@")[0] ?? "?";
  return (name[0] ?? "?").toUpperCase();
}

export function isSnoozed(mail: Pick<Mail, "snoozeUntil">, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return mail.snoozeUntil !== undefined && mail.snoozeUntil > nowSec;
}

export function isUnread(mail: Pick<Mail, "read" | "direction" | "trashed">): boolean {
  return mail.direction === "in" && !mail.trashed && !mail.read;
}

export function downloadAttachment(att: MailAttachment): void {
  const blob = new Blob([att.content], { type: att.mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = att.filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadEml(rawRfc822: string, subject: string): void {
  const blob = new Blob([rawRfc822], { type: "message/rfc822" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(subject || "message").replace(/[^\w.-]+/g, "_")}.eml`;
  a.click();
  URL.revokeObjectURL(url);
}

export function quoteForReply(mail: Mail): string {
  const lines = mail.body.split(/\r?\n/).map((line) => `> ${line}`);
  return `\n\nOn ${formatMailDate(mail.time)}, ${mail.from} wrote:\n${lines.join("\n")}`;
}

export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject || "(no subject)"}`;
}

export function forwardSubject(subject: string): string {
  return /^fwd:/i.test(subject.trim()) ? subject : `Fwd: ${subject || "(no subject)"}`;
}

export function extractEmailAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m?.[1] ?? from).trim();
}
