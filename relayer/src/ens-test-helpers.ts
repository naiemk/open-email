import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { keccak256, toBytes, type Hex, type WalletClient, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { generatePasskey, signWebAuthn } from "../../client/src/passkey.ts";
import { hexToBytes } from "viem";
import { registryAbi } from "./abi.ts";
import type { AnvilStack } from "./anvil.ts";

const DEK_PUBLIC =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
const WRAPPED_DEK = "0xaabbccdd" as Hex;

function registryDir(): string {
  return path.resolve(import.meta.dirname, "../..", "registry");
}

function loadArtifact(relativePath: string): { abi: readonly unknown[]; bytecode: Hex } {
  const full = path.join(registryDir(), "out", relativePath);
  if (!existsSync(full)) {
    const built = spawnSync("forge", ["build"], {
      cwd: registryDir(),
      env: { ...process.env, PATH: `${process.env.PATH ?? ""}:/home/node/.foundry/bin` },
      encoding: "utf8",
    });
    if (built.status !== 0) {
      throw new Error(built.stderr || built.stdout || "forge build failed");
    }
  }
  const json = JSON.parse(readFileSync(full, "utf8")) as {
    abi: readonly unknown[];
    bytecode: { object: Hex };
  };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

/** ETH namehash for a `.eth` 2LD (`vitalik.eth`). */
export function eth2ldLabelhash(name: string): Hex {
  const label = name.slice(0, -".eth".length);
  return keccak256(toBytes(label));
}

export type EnsClaimFixture = {
  ensClaim: Hex;
  nftOwner: Hex;
  passkey: ReturnType<typeof generatePasskey>;
  claimName: (name: string) => Promise<void>;
};

export async function deployEnsClaimFixture(
  stack: AnvilStack,
  registry: Hex = stack.registry,
): Promise<EnsClaimFixture> {
  const account = privateKeyToAccount(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex,
  );
  const nftOwner = account.address;

  const baseRegistrarArt = loadArtifact("MockEns.sol/MockBaseRegistrar.json");
  const nameWrapperArt = loadArtifact("MockEns.sol/MockNameWrapper.json");
  const ensReaderArt = loadArtifact("MockEns.sol/MockEnsNftReader.json");
  const l1MessengerArt = loadArtifact("MockMessenger.sol/MockL1Messenger.json");
  const l2MessengerArt = loadArtifact("MockMessenger.sol/MockL2Messenger.json");
  const ensClaimArt = loadArtifact("EnsClaim.sol/EnsClaim.json");

  const baseRegistrar = await deploy(stack.walletClient, stack.publicClient, baseRegistrarArt);
  const nameWrapper = await deploy(stack.walletClient, stack.publicClient, nameWrapperArt);
  const ensReader = await deploy(stack.walletClient, stack.publicClient, ensReaderArt, [
    baseRegistrar,
    nameWrapper,
  ]);
  const l2Messenger = await deploy(stack.walletClient, stack.publicClient, l2MessengerArt);
  const l1Messenger = await deploy(stack.walletClient, stack.publicClient, l1MessengerArt);
  const ensClaim = await deploy(stack.walletClient, stack.publicClient, ensClaimArt, [
    ensReader,
    registry,
    l1Messenger,
  ]);

  await stack.walletClient.writeContract({
    address: l1Messenger,
    abi: l1MessengerArt.abi,
    functionName: "wire",
    args: [l2Messenger, ensClaim],
    chain: foundry,
    account: privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    ),
  });
  await stack.walletClient.writeContract({
    address: registry,
    abi: registryAbi,
    functionName: "setEnsBridge",
    args: [ensClaim, l2Messenger],
    chain: foundry,
    account: privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    ),
  });

  const passkey = generatePasskey();

  return {
    ensClaim,
    nftOwner,
    passkey,
    claimName: async (name: string) => {
      const labelhash = eth2ldLabelhash(name);
      await stack.walletClient.writeContract({
        address: baseRegistrar,
        abi: baseRegistrarArt.abi,
        functionName: "setOwner",
        args: [BigInt(labelhash), nftOwner],
        chain: foundry,
        account: privateKeyToAccount(
          "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        ),
      });
      const challenge = (await stack.publicClient.readContract({
        address: ensClaim,
        abi: ensClaimArt.abi,
        functionName: "claimChallenge",
        args: [name, passkey.qx, passkey.qy, DEK_PUBLIC, WRAPPED_DEK],
      })) as Hex;
      const auth = signWebAuthn(hexToBytes(challenge), passkey.secretKey);
      await stack.walletClient.writeContract({
        address: ensClaim,
        abi: ensClaimArt.abi,
        functionName: "claim",
        args: [name, passkey.qx, passkey.qy, DEK_PUBLIC, WRAPPED_DEK, auth],
        chain: foundry,
        account,
      });
    },
  };
}

async function deploy(
  walletClient: WalletClient,
  publicClient: PublicClient,
  artifact: { abi: readonly unknown[]; bytecode: Hex },
  args: unknown[] = [],
): Promise<Hex> {
  const account = privateKeyToAccount(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  );
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
    account,
    chain: foundry,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("deploy failed");
  return receipt.contractAddress;
}
