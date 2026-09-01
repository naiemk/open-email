import { describe, expect, it } from "vitest";
import { buildRfc822 } from "./mime-build.ts";

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

  it("builds multipart mixed with attachment", () => {
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
  });
});
