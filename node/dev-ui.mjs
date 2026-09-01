import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.HTTP_PORT ?? "8787";

const backend = spawn(
  "node",
  ["--experimental-strip-types", "--no-warnings", "node/dev-server.ts"],
  { cwd: root, env: { ...process.env, HTTP_PORT: port }, stdio: "inherit" },
);

const frontend = spawn("npm", ["run", "dev"], {
  cwd: join(root, "node/web"),
  env: { ...process.env, VITE_DEV_PORT: "5173" },
  stdio: "inherit",
  shell: true,
});

const stop = () => {
  backend.kill("SIGTERM");
  frontend.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

backend.on("exit", (code) => {
  if (code) stop();
});
frontend.on("exit", (code) => {
  if (code) stop();
});

console.log(`Dev UI: backend :${port}  frontend http://localhost:5173/?mock=1`);
