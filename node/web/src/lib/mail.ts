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
  id: string;
  filename: string;
  mimeType: string;
  size: number;
};

/** Keep in sync with node/src/compose-attachments.ts */
export const MAX_COMPOSE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_COMPOSE_STAGED_BYTES = 25 * 1024 * 1024;

export async function uploadComposeAttachment(
  name: string,
  file: File,
  alreadyStagedBytes = 0,
): Promise<ComposeAttachment> {
  if (file.size > MAX_COMPOSE_ATTACHMENT_BYTES) {
    throw new Error("attachment too large");
  }
  if (alreadyStagedBytes + file.size > MAX_COMPOSE_STAGED_BYTES) {
    throw new Error("staging full");
  }
  const q = new URLSearchParams({
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
  });
  const res = await fetch(`/compose-attachment/${encodeURIComponent(name)}?${q}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === "attachment_too_large" || body.error === "too large" || res.status === 413) {
      throw new Error("attachment too large");
    }
    if (body.error === "staging_full") {
      throw new Error("staging full");
    }
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  const body = (await res.json()) as ComposeAttachment;
  return body;
}

export async function deleteComposeAttachment(name: string, id: string): Promise<void> {
  await fetch(`/compose-attachment/${encodeURIComponent(name)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

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
  const res = await fetch(`/mail-state/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      updates: updates.map((u) => ({
        ...u,
        snoozeUntil: u.snoozeUntil === null ? undefined : u.snoozeUntil,
      })),
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
}

export async function restoreMail(name: string, seq: number): Promise<void> {
  await fetch(`/restore/${encodeURIComponent(name)}/${seq}`, { method: "POST" });
}

export async function emptyTrash(name: string): Promise<void> {
  const res = await fetch(`/empty-trash/${encodeURIComponent(name)}`, { method: "POST" });
  if (!res.ok) throw new Error("empty trash failed");
}

export async function deleteMailPermanently(name: string, seq: number): Promise<void> {
  const res = await fetch(`/delete/${encodeURIComponent(name)}/${seq}`, { method: "POST" });
  if (!res.ok) throw new Error("delete failed");
}

export async function fetchBlob(name: string, cid: string): Promise<Uint8Array> {
  const res = await fetch(`/blobs/${encodeURIComponent(cid)}?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Blob ${cid} not found`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function decryptRows(
  name: string,
  rows: IndexRow[],
  dekPrivate: Uint8Array,
  decryptFailedBody = "Could not decrypt this message.",
): Promise<Mail[]> {
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
        body: decryptFailedBody,
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
  const htmlBody =
    parsed.html?.trim() ||
    htmlFromMimeParts(parsed.attachments) ||
    undefined;
  const attachments: MailAttachment[] = (parsed.attachments ?? [])
    .filter((att) => !att.mimeType?.toLowerCase().includes("text/html"))
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
    htmlBody: htmlBody || undefined,
    attachments,
  };
}

function htmlFromMimeParts(
  parts: Array<{ mimeType?: string; content?: Uint8Array | ArrayBuffer | string }> | undefined,
): string | undefined {
  for (const part of parts ?? []) {
    if (!part.mimeType?.toLowerCase().includes("text/html") || !part.content) continue;
    const bytes =
      part.content instanceof Uint8Array
        ? part.content
        : part.content instanceof ArrayBuffer
          ? new Uint8Array(part.content)
          : new TextEncoder().encode(String(part.content));
    const html = new TextDecoder().decode(bytes).trim();
    if (html) return html;
  }
  return undefined;
}

function looksLikeHtml(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /<!doctype html/i.test(t) || /<\s*(html|body|table|div|center|p)\b/i.test(t);
}

export function getHtmlForView(mail: Pick<Mail, "htmlBody" | "body">): string | undefined {
  if (mail.htmlBody?.trim()) return mail.htmlBody;
  if (looksLikeHtml(mail.body)) return mail.body;
  return undefined;
}

export function hasHtmlBody(mail: Pick<Mail, "htmlBody" | "body">): boolean {
  return Boolean(getHtmlForView(mail));
}

/** Wrap partial HTML fragments in a document that fills the reader width. */
export function wrapHtmlForView(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>
html,body{margin:0;padding:0;width:100%;box-sizing:border-box;background:#fff;color:#111;}
body{padding:16px;overflow:visible;min-height:auto;}
img{max-width:100%!important;height:auto!important;}
table{max-width:100%!important;}
</style></head><body>${html}</body></html>`;
}

function formatAddress(addr: { name?: string; address?: string } | string): string {
  if (typeof addr === "string") return addr;
  if (addr.name && addr.address) return `${addr.name} <${addr.address}>`;
  return addr.address ?? "";
}

export function smtpFrom(domain: string, name: string): string {
  const oeId = name.endsWith(".testnet") ? name.slice(0, -".testnet".length) : name;
  return `${oeId}@${domain}`;
}

export function formatMailDate(ts: number, locale?: string): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
}

export function formatMailWeekday(ts: number, locale?: string): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(locale, { weekday: "long" });
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

export type PreviewKind = "image" | "pdf" | "text" | "video" | "unsupported";

export function previewKind(att: Pick<MailAttachment, "filename" | "mimeType">): PreviewKind {
  const mime = att.mimeType.toLowerCase();
  const ext = att.filename.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) {
    return "image";
  }
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("text/") || ["txt", "csv", "md", "json", "log"].includes(ext)) return "text";
  if (mime.startsWith("video/") || ["mp4", "webm", "ogg"].includes(ext)) return "video";
  return "unsupported";
}

export function attachmentToBlob(att: MailAttachment): Blob {
  // Copy bytes so PDF.js cannot detach the mail cache buffer.
  return new Blob([att.content.slice()], { type: att.mimeType || "application/octet-stream" });
}

export function downloadAttachment(att: MailAttachment): void {
  const blob = attachmentToBlob(att);
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
