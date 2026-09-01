import { baseSepolia, sepolia, type Chain } from "viem/chains";
import { loadDotenv } from "./env.ts";
import { defaultL2RpcUrl } from "./l2.ts";
import { startRelayer } from "./server.ts";
import type { Hex } from "viem";

loadDotenv();

const privateKey = process.env.EVM_PRIVATE_KEY as Hex | undefined;
const registry = process.env.REGISTRY as Hex | undefined;
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("EVM_PRIVATE_KEY must be a 32-byte hex key");
}
if (!registry || !/^0x[0-9a-fA-F]{40}$/.test(registry)) {
  throw new Error("REGISTRY must be the Sepolia registry address");
}

const port = Number(process.env.PORT ?? process.env.HOST_PORT ?? 8080);
const bindHost = process.env.BIND_HOST ?? "0.0.0.0";
const rpcUrl = process.env.L2_RPC_URL ?? defaultL2RpcUrl;
const chain = resolveChain(rpcUrl, process.env.CHAIN_ID);

await startRelayer({
  rpcUrl,
  registry,
  privateKey,
  port,
  bindHost,
  chain,
});

console.log(`relayer listening ${bindHost}:${port} chain ${chain.id} registry ${registry}`);

function resolveChain(rpc: string, chainIdEnv?: string): Chain {
  const id = Number(chainIdEnv ?? 0);
  if (id === baseSepolia.id) return baseSepolia;
  if (id === sepolia.id) return sepolia;
  if (/base[-.]?sepolia/i.test(rpc)) return baseSepolia;
  return sepolia;
}
