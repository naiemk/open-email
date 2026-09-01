import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMailboxStateStore } from "./mailbox-state.ts";

describe("mailbox state", () => {
  let dir = "";
  let path = "";

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("persists flags and merges defaults into index rows", () => {
    dir = mkdtempSync(join(tmpdir(), "oe-mail-state-"));
    path = join(dir, "mailbox-state.json");
    const store = createMailboxStateStore(path);
    store.patch("alice", [{ seq: 1, read: true, starred: true, labels: ["work"] }]);
    store.trash("alice", 2);

    const reloaded = createMailboxStateStore(path);
    expect(reloaded.mergeRow("alice", { seq: 1, direction: "in", cid: "x", time: 1 })).toMatchObject({
      read: true,
      starred: true,
      labels: ["work"],
      trashed: false,
    });
    expect(reloaded.mergeRow("alice", { seq: 2, direction: "in", cid: "y", time: 2 })).toMatchObject({
      read: false,
      trashed: true,
    });
    expect(reloaded.mergeRow("alice", { seq: 3, direction: "out", cid: "z", time: 3 })).toMatchObject({
      read: true,
      trashed: false,
    });
  });

  it("lists labels and clears trash flags", () => {
    dir = mkdtempSync(join(tmpdir(), "oe-mail-state-"));
    path = join(dir, "mailbox-state.json");
    const store = createMailboxStateStore(path);
    store.patch("bob", [
      { seq: 1, labels: ["a", "b"] },
      { seq: 2, labels: ["b", "c"] },
    ]);
    store.trash("bob", 1);
    expect(store.listLabels("bob")).toEqual(["a", "b", "c"]);
    expect(store.trashedSeqs("bob")).toEqual([1]);
    store.clearTrashFlags("bob", [1]);
    expect(store.trashedSeqs("bob")).toEqual([]);
    expect(store.getFlags("bob", 1).labels).toEqual(["a", "b"]);
  });
});
