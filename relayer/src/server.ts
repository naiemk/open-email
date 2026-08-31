import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, type Chain } from "viem/chains";
import { nameRecordOf } from "./anvil.ts";
import { registryAbi } from "./abi.ts";

export type RelayerConfig = {
  rpcUrl: string;
  registry: Hex;
  privateKey: Hex;
  port?: number;
  bindHost?: string;
  chain?: Chain;
};

export type RunningRelayer = {
  url: string;
  close: () => Promise<void>;
};

type AuthBody = {
  r: Hex;
  s: Hex;
  challengeIndex: number | bigint;
  typeIndex: number | bigint;
  authenticatorData: Hex;
  clientDataJSON: string;
};

function toAuth(auth: AuthBody) {
  return {
    r: auth.r,
    s: auth.s,
    challengeIndex: BigInt(auth.challengeIndex),
    typeIndex: BigInt(auth.typeIndex),
    authenticatorData: auth.authenticatorData,
    clientDataJSON: auth.clientDataJSON,
  };
}

export async function startRelayer(config: RelayerConfig): Promise<RunningRelayer> {
  const chain = config.chain ?? foundry;
  const account = privateKeyToAccount(config.privateKey);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });
  const registry = config.registry;

  const server = createServer((req, res) => {
    void handle(req, res, { publicClient, walletClient, account, registry, chain });
  });

  await new Promise<void>((resolve) => {
    server.listen(config.port ?? 0, config.bindHost ?? "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("relayer has no port");
  }

  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => closeServer(server),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: {
    publicClient: ReturnType<typeof createPublicClient>;
    walletClient: ReturnType<typeof createWalletClient>;
    account: Account;
    registry: Hex;
    chain: Chain;
  },
): Promise<void> {
  try {
    const raw = req.url ?? "/";
    const url = new URL(raw.startsWith("/api/") ? raw.slice(4) : raw, "http://relayer.local");
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, service: "relayer" });
    }
    if (req.method === "GET" && url.pathname === "/register-challenge") {
      const name = url.searchParams.get("name") ?? "";
      const dekPublic = url.searchParams.get("dekPublic") as Hex;
      const wrappedDek = url.searchParams.get("wrappedDek") as Hex;
      const challenge = await ctx.publicClient.readContract({
        address: ctx.registry,
        abi: registryAbi,
        functionName: "registerChallenge",
        args: [name, dekPublic, wrappedDek],
      });
      return json(res, 200, { challenge });
    }
    if (req.method === "GET" && url.pathname === "/opt-in-challenge") {
      const name = url.searchParams.get("name") ?? "";
      const nodeKey = url.searchParams.get("nodeKey") as Hex;
      const challenge = await ctx.publicClient.readContract({
        address: ctx.registry,
        abi: registryAbi,
        functionName: "optInChallenge",
        args: [name, nodeKey],
      });
      return json(res, 200, { challenge });
    }
    if (req.method === "GET" && url.pathname.startsWith("/names/")) {
      const name = decodeURIComponent(url.pathname.slice("/names/".length));
      const [qx, qy, dekPublic, wrappedDek] = await nameRecordOf(ctx, name);
      return json(res, 200, { qx, qy, dekPublic, wrappedDek });
    }
    if (req.method === "GET" && url.pathname.startsWith("/opted-in/")) {
      const rest = url.pathname.slice("/opted-in/".length);
      const slash = rest.indexOf("/");
      const name = decodeURIComponent(rest.slice(0, slash));
      const nodeKey = rest.slice(slash + 1) as Hex;
      const optedIn = await ctx.publicClient.readContract({
        address: ctx.registry,
        abi: registryAbi,
        functionName: "isOptedIn",
        args: [name, nodeKey],
      });
      return json(res, 200, { optedIn });
    }
    if (req.method === "POST" && url.pathname === "/register") {
      const body = (await readJson(req)) as {
        name: string;
        qx: Hex;
        qy: Hex;
        dekPublic: Hex;
        wrappedDek: Hex;
        auth: AuthBody;
      };
      const hash = await ctx.walletClient.writeContract({
        address: ctx.registry,
        abi: registryAbi,
        functionName: "register",
        args: [
          body.name,
          body.qx,
          body.qy,
          body.dekPublic,
          body.wrappedDek,
          toAuth(body.auth),
        ],
        account: ctx.account,
        chain: ctx.chain,
      });
      await ctx.publicClient.waitForTransactionReceipt({ hash });
      return json(res, 200, { hash });
    }
    if (req.method === "POST" && url.pathname === "/nodes") {
      const body = (await readJson(req)) as { domain: string; masterKey: Hex };
      const hash = await ctx.walletClient.writeContract({
        address: ctx.registry,
        abi: registryAbi,
        functionName: "registerNode",
        args: [body.domain, body.masterKey],
        account: ctx.account,
        chain: ctx.chain,
      });
      await ctx.publicClient.waitForTransactionReceipt({ hash });
      return json(res, 200, { hash });
    }
    if (req.method === "POST" && url.pathname === "/opt-in") {
      const body = (await readJson(req)) as { name: string; nodeKey: Hex; auth: AuthBody };
      const hash = await ctx.walletClient.writeContract({
        address: ctx.registry,
        abi: registryAbi,
        functionName: "optIn",
        args: [body.name, body.nodeKey, toAuth(body.auth)],
        account: ctx.account,
        chain: ctx.chain,
      });
      await ctx.publicClient.waitForTransactionReceipt({ hash });
      return json(res, 200, { hash });
    }
    if (req.method === "GET" && url.pathname === "/opt-out-challenge") {
      const name = url.searchParams.get("name") ?? "";
      const nodeKey = url.searchParams.get("nodeKey") as Hex;
      const challenge = await ctx.publicClient.readContract({
        address: ctx.registry,
        abi: registryAbi,
        functionName: "optOutChallenge",
        args: [name, nodeKey],
      });
      return json(res, 200, { challenge });
    }
    if (req.method === "POST" && url.pathname === "/opt-out") {
      const body = (await readJson(req)) as { name: string; nodeKey: Hex; auth: AuthBody };
      const hash = await ctx.walletClient.writeContract({
        address: ctx.registry,
        abi: registryAbi,
        functionName: "optOut",
        args: [body.name, body.nodeKey, toAuth(body.auth)],
        account: ctx.account,
        chain: ctx.chain,
      });
      await ctx.publicClient.waitForTransactionReceipt({ hash });
      return json(res, 200, { hash });
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 400, { error: revertName(err) ?? "failed" });
  }
}

function revertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    return reverted.data?.errorName;
  }
  return undefined;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
