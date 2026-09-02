import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { registryAbi } from "./abi.ts";

export const ANVIL_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

/** Anvil account #1 — a distinct EOA from the registry owner / relayer. */
export const ANVIL_ACCOUNT_1 =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

const foundryPath = `${process.env.PATH ?? ""}:/home/node/.foundry/bin`;

function registryDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", "registry");
}

function registryArtifactPath(): string {
  return path.join(registryDir(), "out/OpenEmailRegistry.sol/OpenEmailRegistry.json");
}

function newestMtimeMs(dir: string): number {
  let newest = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) {
      newest = Math.max(newest, newestMtimeMs(full));
      continue;
    }
    newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

/** Compile the registry once. Later callers reuse `out/` unless src or foundry.toml changed. */
export function ensureRegistryBuilt(): void {
  const cwd = registryDir();
  const artifact = registryArtifactPath();
  if (existsSync(artifact)) {
    const srcNewest = Math.max(
      newestMtimeMs(path.join(cwd, "src")),
      existsSync(path.join(cwd, "foundry.toml")) ? statSync(path.join(cwd, "foundry.toml")).mtimeMs : 0,
    );
    if (srcNewest <= statSync(artifact).mtimeMs) return;
  }
  const built = spawnSync("forge", ["build", "--skip", "test", "--skip", "script"], {
    cwd,
    env: { ...process.env, PATH: foundryPath },
    encoding: "utf8",
  });
  if (built.status !== 0) {
    throw new Error(built.stderr || built.stdout || "forge build failed");
  }
}

export type AnvilStack = {
  rpcUrl: string;
  registry: Hex;
  publicClient: PublicClient;
  walletClient: WalletClient;
  stop: () => Promise<void>;
};

export type AnvilRegistryMode = {
  testnetMode?: boolean;
  minStemLength?: bigint;
};

export async function startAnvilStack(mode: AnvilRegistryMode = {}): Promise<AnvilStack> {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = spawn("anvil", ["--port", String(port), "--hardfork", "osaka"], {
    env: { ...process.env, PATH: foundryPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForRpc(rpcUrl, anvil);

  const account = privateKeyToAccount(ANVIL_PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(rpcUrl),
  });

  const artifact = loadRegistryArtifact();
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    account,
    chain: foundry,
    args: [mode.testnetMode ?? false, mode.minStemLength ?? 5n],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error("registry deploy produced no address");
  }

  const registry = receipt.contractAddress;

  return {
    rpcUrl,
    registry,
    publicClient,
    walletClient,
    stop: async () => {
      anvil.kill("SIGTERM");
    },
  };
}

type RegistryReadClient = {
  publicClient: { readContract: PublicClient["readContract"] };
  registry: Hex;
};

export type NameRecordTuple = readonly [Hex, Hex, Hex, Hex];

export async function nameRecordOf(client: RegistryReadClient, name: string): Promise<NameRecordTuple> {
  return client.publicClient.readContract({
    address: client.registry,
    abi: registryAbi,
    functionName: "nameRecord",
    args: [name],
  }) as Promise<NameRecordTuple>;
}

export async function nodeOf(client: RegistryReadClient, masterKey: Hex): Promise<string> {
  return client.publicClient.readContract({
    address: client.registry,
    abi: registryAbi,
    functionName: "nodeOf",
    args: [masterKey],
  }) as Promise<string>;
}

export async function isOptedIn(
  client: RegistryReadClient,
  name: string,
  nodeKey: Hex,
): Promise<boolean> {
  return client.publicClient.readContract({
    address: client.registry,
    abi: registryAbi,
    functionName: "isOptedIn",
    args: [name, nodeKey],
  }) as Promise<boolean>;
}

export async function mailboxGenerationOf(client: RegistryReadClient, name: string): Promise<number> {
  const gen = await client.publicClient.readContract({
    address: client.registry,
    abi: registryAbi,
    functionName: "mailboxGeneration",
    args: [name],
  });
  return Number(gen);
}

export function defaultRegistryClient(stack: RegistryReadClient) {
  return {
    isOptedIn: (name: string, nodeKey: Hex) => isOptedIn(stack, name, nodeKey),
    nameRecord: async (name: string) => {
      const [, , dekPublic, wrappedDek] = await nameRecordOf(stack, name);
      return { dekPublic, wrappedDek };
    },
    mailboxGeneration: (name: string) => mailboxGenerationOf(stack, name),
  };
}

export function loadRegistryArtifact(): { abi: typeof registryAbi; bytecode: Hex } {
  const artifactPath = registryArtifactPath();
  const json = JSON.parse(readFileSync(artifactPath, "utf8")) as {
    bytecode: { object: Hex };
  };
  return { abi: registryAbi, bytecode: json.bytecode.object };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("no port"));
        return;
      }
      const port = addr.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForRpc(rpcUrl: string, child: ChildProcess): Promise<void> {
  const started = Date.now();
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.on("exit", (code) => {
    if (code && Date.now() - started < 15_000) {
      stderr += `anvil exited ${code}`;
    }
  });
  while (Date.now() - started < 15_000) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`anvil did not start: ${stderr}`);
}
