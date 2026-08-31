import { createHash, createSign } from "node:crypto";

export type DkimKey = {
  selector: string;
  domain: string;
  privateKeyPem: string;
};

export function signDkim(rfc5322: string, key: DkimKey, t = Math.floor(Date.now() / 1000)): string {
  const msg = rfc5322.includes("\r\n") ? rfc5322 : rfc5322.replace(/\n/g, "\r\n");
  const split = msg.indexOf("\r\n\r\n");
  const rawHeaders = split === -1 ? msg : msg.slice(0, split);
  const body = split === -1 ? "" : msg.slice(split + 4);
  const headers = parseHeaders(rawHeaders);
  const bh = sha256b64(relaxBody(body));
  const dkimNoB =
    `v=1; a=rsa-sha256; c=relaxed/relaxed; d=${key.domain}; s=${key.selector}; t=${t}; ` +
    `bh=${bh}; h=from:to:subject; b=`;
  const canonical =
    relaxHeader("from", headerValue(headers, "from")) +
    relaxHeader("to", headerValue(headers, "to")) +
    relaxHeader("subject", headerValue(headers, "subject")) +
    relaxHeader("dkim-signature", dkimNoB);
  const signer = createSign("RSA-SHA256");
  signer.update(canonical);
  signer.end();
  const b = signer.sign(key.privateKeyPem, "base64");
  return `DKIM-Signature: ${dkimNoB}${b}\r\n${msg}`;
}

function parseHeaders(raw: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const line of raw.split("\r\n")) {
    if (/^[ \t]/.test(line) && out.length) {
      out[out.length - 1]!.value += ` ${line.trim()}`;
      continue;
    }
    const i = line.indexOf(":");
    if (i === -1) continue;
    out.push({ name: line.slice(0, i), value: line.slice(i + 1).trim() });
  }
  return out;
}

function headerValue(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";
}

function relaxHeader(name: string, value: string): string {
  const v = value.replace(/\r\n[ \t]/g, " ").replace(/[ \t]+/g, " ").trim();
  return `${name.toLowerCase()}:${v}\r\n`;
}

function relaxBody(body: string): string {
  const lines = body.split("\r\n").map((line) => line.replace(/[ \t]+$/g, "").replace(/[ \t]+/g, " "));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\r\n")}\r\n`;
}

function sha256b64(text: string): string {
  return createHash("sha256").update(text).digest("base64");
}
