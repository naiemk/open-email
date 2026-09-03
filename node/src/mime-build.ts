export type OutboundAttachment = {
  filename: string;
  mimeType: string;
  contentBase64: string;
};

export function buildRfc822(input: {
  mailFrom: string;
  to: string;
  subject: string;
  body: string;
  attachments?: OutboundAttachment[];
}): string {
  const subject = encodeSubject(input.subject);
  const entity = buildMimeEntity({ body: input.body, attachments: input.attachments });
  return [`From: ${input.mailFrom}`, `To: ${input.to}`, `Subject: ${subject}`, entity].join("\r\n");
}

/**
 * MIME entity only (no From/To/Subject). Used as the plaintext inside PGP/MIME (RFC 3156).
 */
export function buildMimeEntity(input: {
  body: string;
  attachments?: OutboundAttachment[];
}): string {
  const headers = ["MIME-Version: 1.0"];
  const attachments = input.attachments ?? [];
  const text = encodeTextBody(input.body);
  if (!attachments.length) {
    return [
      ...headers,
      `Content-Type: text/plain; charset=utf-8`,
      `Content-Transfer-Encoding: ${text.encoding}`,
      "",
      text.content,
      "",
    ].join("\r\n");
  }
  const boundary = `----=_OE_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const parts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    `Content-Transfer-Encoding: ${text.encoding}`,
    "",
    text.content,
    "",
  ];
  for (const att of attachments) {
    const filename = att.filename.replace(/[\r\n"]/g, "_");
    const contentType = attachmentContentType(filename, att.mimeType);
    parts.push(
      `--${boundary}`,
      `Content-Type: ${contentType}; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
      "",
      wrapBase64(att.contentBase64.replace(/^data:[^;]+;base64,/, "")),
      "",
    );
  }
  parts.push(`--${boundary}--`, "");
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}

/**
 * Browsers often report .md as text/x-markdown. ProtonMail (and some PGP paths) then
 * surface the part as raw MIME instead of a downloadable file — and can hide the text body.
 * Force a generic binary type so the part stays a true attachment.
 */
export function attachmentContentType(filename: string, mimeType: string): string {
  const mime = (mimeType || "").toLowerCase().split(";")[0]?.trim() ?? "";
  if (
    mime === "text/x-markdown" ||
    mime === "text/markdown" ||
    mime === "text/x-web-markdown" ||
    /\.md$/i.test(filename) ||
    /\.markdown$/i.test(filename)
  ) {
    return "application/octet-stream";
  }
  return mimeType?.trim() || "application/octet-stream";
}

function utf8ToBase64(text: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf8").toString("base64");
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function encodeTextBody(body: string): { encoding: "7bit" | "base64"; content: string } {
  const normalized = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const asciiSafe =
    /^[\x00-\x7F]*$/.test(normalized) && !normalized.split("\n").some((line) => line.length > 998);
  if (asciiSafe) {
    return { encoding: "7bit", content: normalized.replace(/\n/g, "\r\n") };
  }
  return {
    encoding: "base64",
    content: wrapBase64(utf8ToBase64(normalized)),
  };
}

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${utf8ToBase64(subject)}?=`;
}

function wrapBase64(raw: string): string {
  const cleaned = raw.replace(/\s/g, "");
  const lines: string[] = [];
  for (let i = 0; i < cleaned.length; i += 76) lines.push(cleaned.slice(i, i + 76));
  return lines.join("\r\n");
}
