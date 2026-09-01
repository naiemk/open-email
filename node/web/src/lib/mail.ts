import { openEnvelope } from "@client/envelope.ts";
import { apiJson } from "@/lib/api-fetch";

export type IndexRow = {
  seq: number;
  cid: string;
  direction: "in" | "out";
  trashed: boolean;
  time: number;
};

export type Mail = IndexRow & { from: string; subject: string; body: string; unread?: boolean };

export async function fetchIndex(name: string, before?: number): Promise<IndexRow[]> {
  const q = before ? `?before=${before}` : "";
  return apiJson<IndexRow[]>(`/index/${encodeURIComponent(name)}${q}`);
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
      const raw = new TextDecoder().decode(await openEnvelope(dekPrivate, name, blob));
      mails.push({ ...row, ...parseRfc822(raw), unread: row.direction === "in" && !row.trashed });
    } catch {
      mails.push({
        ...row,
        from: "(decrypt failed)",
        subject: `Message #${row.seq}`,
        body: "Could not decrypt this message.",
        unread: false,
      });
    }
  }
  return mails;
}

function parseRfc822(raw: string): { from: string; subject: string; body: string } {
  const split = raw.includes("\r\n\r\n") ? "\r\n\r\n" : "\n\n";
  const i = raw.indexOf(split);
  const head = i === -1 ? raw : raw.slice(0, i);
  const body = i === -1 ? "" : raw.slice(i + split.length);
  const header = (n: string) => head.match(new RegExp(`^${n}:\\s*(.*)$`, "im"))?.[1]?.trim() ?? "";
  return { from: header("From"), subject: header("Subject"), body };
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
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function senderInitial(from: string): string {
  const name = from.replace(/^.*<([^>]+)>.*$/, "$1").split("@")[0] ?? "?";
  return (name[0] ?? "?").toUpperCase();
}
