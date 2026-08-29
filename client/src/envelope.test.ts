import { describe, expect, it } from "vitest";
import { generateDek } from "./dek.ts";
import { openEnvelope, sealEnvelope } from "./envelope.ts";

describe("envelope", () => {
  it("seals RFC 5322 to DEK_public so only the private half opens it, and the blob is not plaintext", async () => {
    const dek = generateDek();
    const rfc5322 = new TextEncoder().encode("From: gmail@example.com\r\nSubject: tracer\r\n\r\nhello alice\r\n");
    const blob = await sealEnvelope(dek.publicKey, "alice", rfc5322);

    expect(new TextDecoder().decode(blob)).not.toContain("Subject: tracer");
    expect(new TextDecoder().decode(blob)).not.toContain("hello alice");
    await expect(openEnvelope(generateDek().privateKey, "alice", blob)).rejects.toThrow();

    const opened = await openEnvelope(dek.privateKey, "alice", blob);
    expect(new TextDecoder().decode(opened)).toBe(new TextDecoder().decode(rfc5322));
  });
});
