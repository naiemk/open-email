import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

let proc: ChildProcess | null = null;

export default async function globalSetup() {
  const env = {
    ...process.env,
    PATH: `/home/node/.foundry/bin:${process.env.PATH ?? ""}`,
    E2E_HARNESS: "1",
  };
  proc = spawn("node", ["--experimental-strip-types", "--no-warnings", "e2e/start-stack.ts"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const urls = await new Promise<{ nodeA: string; nodeB: string }>((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("e2e stack timeout")), 120_000);
    proc!.stdout!.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const match = buf.match(/E2E_URLS (\{.*\})/);
      if (match) {
        clearTimeout(timer);
        resolve(JSON.parse(match[1]!) as { nodeA: string; nodeB: string });
      }
    });
    proc!.stderr!.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
    proc!.on("exit", (code) => {
      if (code) reject(new Error(`e2e stack exited ${code}`));
    });
  });
  writeFileSync(join(process.cwd(), "e2e/.urls.json"), JSON.stringify(urls));
  process.env.E2E_NODE_A = urls.nodeA;
  process.env.E2E_NODE_B = urls.nodeB;
}

process.on("exit", () => {
  proc?.kill("SIGTERM");
});
