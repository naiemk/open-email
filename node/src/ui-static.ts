import { existsSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";

const UI_ROOT = fileURLToPath(new URL("../web/dist", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

export function uiDistExists(): boolean {
  return existsSync(join(UI_ROOT, "index.html"));
}

export function serveUiAsset(pathname: string, res: ServerResponse): boolean {
  if (!uiDistExists()) return false;
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const file = join(UI_ROOT, rel);
  if (!file.startsWith(UI_ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
    if (pathname !== "/" && !pathname.includes(".")) {
      const spa = join(UI_ROOT, "index.html");
      if (existsSync(spa)) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(readFileSync(spa));
        return true;
      }
    }
    return false;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
  return true;
}
