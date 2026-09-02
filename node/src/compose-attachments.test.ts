import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createComposeAttachmentStore } from "./compose-attachments.ts";

describe("compose attachment store", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("stages uploads and resolves them for send", () => {
    const dir = mkdtempSync(join(tmpdir(), "oe-compose-"));
    dirs.push(dir);
    const store = createComposeAttachmentStore(dir);
    const id = store.put("alice", "note.txt", "text/plain", Buffer.from("hi"));
    const attachments = store.take("alice", [id]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.filename).toBe("note.txt");
    expect(attachments[0]?.contentBase64).toBe("aGk=");
    expect(() => store.take("alice", [id])).toThrow();
  });

  it("removes staged uploads", () => {
    const dir = mkdtempSync(join(tmpdir(), "oe-compose-"));
    dirs.push(dir);
    const store = createComposeAttachmentStore(dir);
    const id = store.put("alice", "a.bin", "application/octet-stream", Buffer.from("x"));
    expect(store.remove("alice", id)).toBe(true);
    expect(() => store.take("alice", [id])).toThrow();
  });
});
