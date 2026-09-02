import { describe, expect, it } from "vitest";
import { attachmentContentType, buildRfc822 } from "./mime-build.ts";

describe("buildRfc822", () => {
  it("builds plain text when there are no attachments", () => {
    const msg = buildRfc822({
      mailFrom: "alice@node.test",
      to: "bob@example.com",
      subject: "Hello",
      body: "Hi Bob",
    });
    expect(msg).toContain("From: alice@node.test");
    expect(msg).toContain("Subject: Hello");
    expect(msg).toContain("Hi Bob");
    expect(msg).not.toContain("multipart/mixed");
  });

  it("builds multipart mixed with attachment and keeps the text body part", () => {
    const msg = buildRfc822({
      mailFrom: "alice@node.test",
      to: "bob@example.com",
      subject: "Files",
      body: "See attached",
      attachments: [{ filename: "note.txt", mimeType: "text/plain", contentBase64: "aGk=" }],
    });
    expect(msg).toContain("multipart/mixed");
    expect(msg).toContain('filename="note.txt"');
    expect(msg).toContain("aGk=");
    expect(msg).toMatch(/Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\nSee attached/);
  });

  it("uses application/octet-stream for markdown attachments", () => {
    const msg = buildRfc822({
      mailFrom: "alice@node.test",
      to: "bob@proton.me",
      subject: "PoD",
      body: "Please read the guide.",
      attachments: [
        {
          filename: "pod_for_dummies.md",
          mimeType: "text/x-markdown",
          contentBase64: Buffer.from("# Privacy on Demand\n").toString("base64"),
        },
      ],
    });
    expect(msg).toContain("Please read the guide.");
    expect(msg).toContain('Content-Type: application/octet-stream; name="pod_for_dummies.md"');
    expect(msg).not.toContain("text/x-markdown");
    expect(msg).toContain('Content-Disposition: attachment; filename="pod_for_dummies.md"');
  });

  it("base64-encodes non-ascii text bodies", () => {
    const msg = buildRfc822({
      mailFrom: "alice@node.test",
      to: "bob@example.com",
      subject: "مرحبا",
      body: "سلام دنیا",
    });
    expect(msg).toContain("Content-Transfer-Encoding: base64");
    expect(msg).toContain(Buffer.from("سلام دنیا", "utf8").toString("base64").slice(0, 8));
  });
});

describe("attachmentContentType", () => {
  it("maps markdown mime and extensions to octet-stream", () => {
    expect(attachmentContentType("pod_for_dummies.md", "text/x-markdown")).toBe("application/octet-stream");
    expect(attachmentContentType("notes.markdown", "text/plain")).toBe("application/octet-stream");
    expect(attachmentContentType("x.md", "")).toBe("application/octet-stream");
    expect(attachmentContentType("note.txt", "text/plain")).toBe("text/plain");
  });
});
