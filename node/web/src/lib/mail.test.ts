import { describe, expect, it } from "vitest";
import { getHtmlForView, hasHtmlBody, parseRfc822, wrapHtmlForView } from "./mail.ts";

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

  it("detects html bodies", () => {
    expect(hasHtmlBody({ htmlBody: "<p>Hi</p>", body: "" })).toBe(true);
    expect(hasHtmlBody({ htmlBody: "  ", body: "" })).toBe(false);
    expect(hasHtmlBody({ htmlBody: "", body: "<table><tr><td>x</td></tr></table>" })).toBe(true);
    expect(getHtmlForView({ htmlBody: "", body: "<div>Hi</div>" })).toContain("<div");
    expect(wrapHtmlForView("<p>Hi</p>")).toContain("<!DOCTYPE html>");
  });
});

describe("previewKind", () => {
  it("classifies common attachment types", async () => {
    const { previewKind } = await import("./mail.ts");
    expect(previewKind({ filename: "a.png", mimeType: "image/png" })).toBe("image");
    expect(previewKind({ filename: "a.PDF", mimeType: "application/octet-stream" })).toBe("pdf");
    expect(previewKind({ filename: "notes.txt", mimeType: "text/plain" })).toBe("text");
    expect(previewKind({ filename: "clip.mp4", mimeType: "video/mp4" })).toBe("video");
    expect(previewKind({ filename: "doc.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe(
      "unsupported",
    );
  });
});
