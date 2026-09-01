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
  const headers = [`From: ${input.mailFrom}`, `To: ${input.to}`, `Subject: ${subject}`, "MIME-Version: 1.0"];
  const attachments = input.attachments ?? [];
  if (!attachments.length) {
    return [...headers, "Content-Type: text/plain; charset=utf-8", "", input.body, ""].join("\r\n");
  }
  const boundary = `----=_OE_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const parts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    input.body,
    "",
  ];
  for (const att of attachments) {
    const filename = att.filename.replace(/[\r\n"]/g, "_");
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType || "application/octet-stream"}; name="${filename}"`,
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

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  const b64 = Buffer.from(subject, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function wrapBase64(raw: string): string {
  const cleaned = raw.replace(/\s/g, "");
  const lines: string[] = [];
  for (let i = 0; i < cleaned.length; i += 76) lines.push(cleaned.slice(i, i + 76));
  return lines.join("\r\n");
}
