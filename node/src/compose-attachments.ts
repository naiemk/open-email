import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { OutboundAttachment } from "./mime-build.ts";

export const MAX_COMPOSE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_COMPOSE_STAGED_BYTES = 25 * 1024 * 1024;
const TTL_MS = 24 * 60 * 60 * 1000;

type Meta = {
  name: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: number;
};

export type ComposeAttachmentStore = {
  put: (name: string, filename: string, mimeType: string, bytes: Buffer) => string;
  take: (name: string, ids: string[]) => OutboundAttachment[];
  remove: (name: string, id: string) => boolean;
  purgeExpired: (now?: number) => void;
};

export function createComposeAttachmentStore(dataDir: string): ComposeAttachmentStore {
  const dir = join(dataDir, "compose-staging");
  mkdirSync(dir, { recursive: true });

  const metaPath = (id: string) => join(dir, `${id}.json`);
  const binPath = (id: string) => join(dir, `${id}.bin`);

  const readMeta = (id: string): Meta | undefined => {
    const path = metaPath(id);
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf8")) as Meta;
  };

  const stagedBytesFor = (name: string): number => {
    let total = 0;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const meta = readMeta(file.slice(0, -".json".length));
      if (meta?.name === name) total += meta.size;
    }
    return total;
  };

  const drop = (id: string) => {
    for (const path of [metaPath(id), binPath(id)]) {
      if (existsSync(path)) unlinkSync(path);
    }
  };

  return {
    purgeExpired(now = Date.now()) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        const id = file.slice(0, -".json".length);
        const meta = readMeta(id);
        if (meta && now - meta.createdAt > TTL_MS) drop(id);
      }
    },

    put(name, filename, mimeType, bytes) {
      this.purgeExpired();
      if (bytes.length > MAX_COMPOSE_ATTACHMENT_BYTES) {
        throw new Error("attachment too large");
      }
      if (stagedBytesFor(name) + bytes.length > MAX_COMPOSE_STAGED_BYTES) {
        throw new Error("staging full");
      }
      const id = randomBytes(16).toString("hex");
      writeFileSync(binPath(id), bytes);
      writeFileSync(
        metaPath(id),
        JSON.stringify({
          name,
          filename,
          mimeType,
          size: bytes.length,
          createdAt: Date.now(),
        } satisfies Meta),
      );
      return id;
    },

    take(name, ids) {
      const out: OutboundAttachment[] = [];
      for (const id of ids) {
        const meta = readMeta(id);
        if (!meta || meta.name !== name) throw new Error("attachment not found");
        const bytes = readFileSync(binPath(id));
        out.push({
          filename: meta.filename,
          mimeType: meta.mimeType,
          contentBase64: bytes.toString("base64"),
        });
        drop(id);
      }
      return out;
    },

    remove(name, id) {
      const meta = readMeta(id);
      if (!meta || meta.name !== name) return false;
      drop(id);
      return true;
    },
  };
}
