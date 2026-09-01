import { describe, expect, it } from "vitest";
import { parseRfc822 } from "./mail.ts";

describe("parseRfc822", () => {
  it("parses plain text messages", async () => {
    const raw = [
      "From: Alice <alice@example.com>",
      "To: Bob <bob@example.com>",
      "Subject: Lunch",
      "",
      "See you at 1.",
    ].join("\r\n");
    const parsed = await parseRfc822(raw);
    expect(parsed.subject).toBe("Lunch");
    expect(parsed.body).toContain("See you at 1.");
    expect(parsed.attachments).toHaveLength(0);
  });

  it("detects attachments in multipart messages", async () => {
    const boundary = "----test";
    const raw = [
      "From: Alice <alice@example.com>",
      "To: Bob <bob@example.com>",
      "Subject: Files",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Body text",
      `--${boundary}`,
      'Content-Type: text/plain; name="note.txt"',
      "Content-Transfer-Encoding: base64",
      'Content-Disposition: attachment; filename="note.txt"',
      "",
      "aGk=",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const parsed = await parseRfc822(raw);
    expect(parsed.body).toContain("Body text");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.filename).toBe("note.txt");
  });
});
