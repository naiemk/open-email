import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
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

const foundryPath = `${process.env.PATH ?? ""}:/home/node/.foundry/bin`;

export type AnvilStack = {
  rpcUrl: string;
  registry: Hex;
  publicClient: PublicClient;
  walletClient: WalletClient;
  stop: () => Promise<void>;
};

export async function startAnvilStack(): Promise<AnvilStack> {
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
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error("registry deploy produced no address");
  }

  return {
    rpcUrl,
    registry: receipt.contractAddress,
    publicClient,
    walletClient,
    stop: async () => {
      anvil.kill("SIGTERM");
    },
  };
}

export async function nameRecordOf(stack: AnvilStack, name: string) {
  return stack.publicClient.readContract({
    address: stack.registry,
    abi: registryAbi,
    functionName: "nameRecord",
    args: [name],
  });
}

export async function isOptedIn(stack: AnvilStack, name: string, nodeKey: Hex) {
  return stack.publicClient.readContract({
    address: stack.registry,
    abi: registryAbi,
    functionName: "isOptedIn",
    args: [name, nodeKey],
  });
}

function loadRegistryArtifact(): { abi: typeof registryAbi; bytecode: Hex } {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const artifactPath = path.join(
    root,
    "registry/out/OpenEmailRegistry.sol/OpenEmailRegistry.json",
  );
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
