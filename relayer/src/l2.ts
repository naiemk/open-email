import { concatHex, createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { ensureRegistryBuilt, loadRegistryArtifact } from "./anvil.ts";
import { loadDotenv } from "./env.ts";

type P256Client = {
  getCode: (args: { address: Hex }) => Promise<Hex | undefined>;
  call: (args: { to: Hex; data: Hex }) => Promise<{ data?: Hex }>;
  estimateGas: (args: { to: Hex; data: Hex }) => Promise<bigint>;
};

export const l2Chain = baseSepolia;
export const defaultL2RpcUrl = "https://base-sepolia-rpc.publicnode.com";
const P256VERIFY = "0x0000000000000000000000000000000000000100" as const;
/** RIP-7212 gas is 3_450; Solidity fallback is ~330k. Intrinsic + native stays well under this. */
const NATIVE_P256_GAS_CEILING = 80_000n;
/** Wycheproof vector used by OpenZeppelin P256 to probe the precompile. */
const RIP7212_PROBE = concatHex([
  "0xbb5a52f42f9c9261ed4361f59422a1e30036e7c32b270c8807a419feca605023",
  "0x0000000000000000000000000000000000000000000000000000000000000005",
  "0x0000000000000000000000000000000000000000000000000000000000000001",
  "0xa71af64de5126a4a4e02b7922d66ce9415ce88a4c9d25514d91082c8725ac957",
  "0x5d47723c8fbe580bb369fec9c2665d8e30a435b9932645482e7c9f11e872296b",
]);
const RIP7212_VALID = ("0x" + "0".repeat(62) + "01") as Hex;

export type L2RelayerEnv = {
  rpcUrl: string;
  privateKey: Hex;
};

export function readL2RelayerEnv(): L2RelayerEnv | undefined {
  loadDotenv();
  const rpcUrl = process.env.L2_RPC_URL;
  const privateKey = process.env.EVM_PRIVATE_KEY as Hex | undefined;
  if (!rpcUrl || !privateKey) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("EVM_PRIVATE_KEY must be a 32-byte hex key");
  }
  return { rpcUrl, privateKey };
}

export async function deployRegistryOnL2(env: L2RelayerEnv) {
  ensureRegistryBuilt();
  const account = privateKeyToAccount(env.privateKey);
  const publicClient = createPublicClient({ chain: l2Chain, transport: http(env.rpcUrl) });
  const bal = await publicClient.getBalance({ address: account.address });
  if (bal === 0n) {
    throw new Error(
      `relayer ${account.address} has 0 ETH on ${l2Chain.name}; fund it from a faucet then re-run`,
    );
  }
  const walletClient = createWalletClient({
    account,
    chain: l2Chain,
    transport: http(env.rpcUrl),
  });
  const artifact = loadRegistryArtifact();
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    account,
    chain: l2Chain,
    gas: 8_000_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (!receipt.contractAddress) throw new Error("L2 registry deploy produced no address");
  return { registry: receipt.contractAddress, publicClient, accountAddress: account.address };
}

/** RIP-7212 / EIP-7951: native P-256 verify at 0x100, not the Solidity fallback. */
export async function p256verifyIsNative(publicClient: P256Client): Promise<boolean> {
  const code = await publicClient.getCode({ address: P256VERIFY });
  if (code && code !== "0x") return false;
  const result = await publicClient.call({ to: P256VERIFY, data: RIP7212_PROBE });
  if (result.data !== RIP7212_VALID) return false;
  const gas = await publicClient.estimateGas({ to: P256VERIFY, data: RIP7212_PROBE });
  return gas < NATIVE_P256_GAS_CEILING;
}
