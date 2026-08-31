import { openEnvelope } from "@client/envelope.ts";
import type { Hex } from "viem";

export type IndexRow = {
  seq: number;
  cid: string;
  direction: "in" | "out";
  trashed: boolean;
  time: number;
};

export type Mail = IndexRow & { from: string; subject: string; body: string };

export async function fetchIndex(name: string, before?: number): Promise<IndexRow[]> {
  const q = before ? `?before=${before}` : "";
  return (await (await fetch(`/index/${encodeURIComponent(name)}${q}`)).json()) as IndexRow[];
}

export async function fetchBlob(name: string, cid: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(`/blobs/${encodeURIComponent(cid)}?name=${encodeURIComponent(name)}`)).arrayBuffer());
}

export async function decryptRows(name: string, rows: IndexRow[], dekPrivate: Uint8Array): Promise<Mail[]> {
  const mails: Mail[] = [];
  for (const row of rows) {
    const blob = await fetchBlob(name, row.cid);
    const raw = new TextDecoder().decode(await openEnvelope(dekPrivate, name, blob));
    mails.push({ ...row, ...parseRfc822(raw) });
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
