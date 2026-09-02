import { describe, expect, it } from "vitest";
import { normalizeSmtpData } from "./smtpSend.ts";

describe("normalizeSmtpData", () => {
  it("does not double CR on already-CRLF MIME messages", () => {
    const msg = [
      "From: alice@node.test",
      "To: bob@proton.me",
      "Subject: Files",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hello body",
      "",
      "--b",
      'Content-Type: application/octet-stream; name="pod.md"',
      "Content-Transfer-Encoding: base64",
      'Content-Disposition: attachment; filename="pod.md"',
      "",
      "IyBQb0Q=",
      "",
      "--b--",
      "",
    ].join("\r\n");
    const out = normalizeSmtpData(msg);
    expect(out).not.toContain("\r\r\n");
    expect(out).toContain("\r\n--b\r\n");
    expect(out).toContain("\r\nHello body\r\n");
  });

  it("converts bare LF to CRLF", () => {
    expect(normalizeSmtpData("a\nb\n")).toBe("a\r\nb\r\n");
  });

  it("dot-stuffs lines that begin with a period", () => {
    expect(normalizeSmtpData("ok\r\n.\r\nend")).toBe("ok\r\n..\r\nend");
  });
});
