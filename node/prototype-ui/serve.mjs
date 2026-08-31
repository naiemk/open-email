import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 4173;

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  try {
    const bytes = await readFile(path.join(dir, file));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`prototype node UI  http://127.0.0.1:${port}/?variant=A`);
});
