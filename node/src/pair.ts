import type { IncomingMessage, ServerResponse } from "node:http";
import type { Hex } from "viem";
import type { CredentialWrapStore } from "./credential-wraps.ts";

export type PairSession = {
  sid: string;
  name: string;
  hostCredentialId: Hex;
  guestPub?: Hex;
  sealedDek?: Hex;
  status: "waiting" | "joined" | "granted" | "finished" | "expired";
  expiresAt: number;
  createdAt: number;
};

export type PairStore = {
  create: (input: { name: string; hostCredentialId: Hex; ttlMs?: number }) => PairSession;
  get: (sid: string) => PairSession | undefined;
  join: (sid: string, guestPub: Hex) => PairSession | { error: string };
  grant: (sid: string, hostCredentialId: Hex, sealedDek: Hex) => PairSession | { error: string };
  markFinished: (sid: string) => PairSession | { error: string };
};

export function createPairStore(now: () => number = () => Date.now()): PairStore {
  const sessions = new Map<string, PairSession>();
  let n = 0;
  const purge = () => {
    const t = now();
    for (const [sid, s] of sessions) {
      if (s.expiresAt <= t && s.status !== "granted" && s.status !== "finished") sessions.delete(sid);
    }
  };
  return {
    create({ name, hostCredentialId, ttlMs = 5 * 60_000 }) {
      purge();
      const sid = `pair-${++n}-${now().toString(36)}`;
      const session: PairSession = {
        sid,
        name,
        hostCredentialId,
        status: "waiting",
        expiresAt: now() + ttlMs,
        createdAt: now(),
      };
      sessions.set(sid, session);
      return session;
    },
    get(sid) {
      purge();
      const s = sessions.get(sid);
      if (!s) return undefined;
      if (s.expiresAt <= now() && s.status !== "granted") return undefined;
      return s;
    },
    join(sid, guestPub) {
      const s = this.get(sid);
      if (!s) return { error: "unknown session" };
      if (s.status !== "waiting") return { error: "session not open" };
      s.guestPub = guestPub;
      s.status = "joined";
      return s;
    },
    grant(sid, hostCredentialId, sealedDek) {
      const s = this.get(sid);
      if (!s) return { error: "unknown session" };
      if (s.hostCredentialId.toLowerCase() !== hostCredentialId.toLowerCase()) return { error: "host credential" };
      if (s.status !== "joined" || !s.guestPub) return { error: "guest not joined" };
      s.sealedDek = sealedDek;
      s.status = "granted";
      return s;
    },
    markFinished(sid) {
      const s = this.get(sid);
      if (!s) return { error: "unknown session" };
      if (s.status !== "granted") return { error: "not granted" };
      s.status = "finished";
      sessions.delete(sid);
      return s;
    },
  };
}

export async function handlePair(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  pair: PairStore,
  wraps: CredentialWrapStore,
): Promise<boolean> {
  if (!url.pathname.startsWith("/pair/")) return false;

  if (req.method === "POST" && url.pathname === "/pair/sessions") {
    const body = (await readJson(req)) as { name?: string; hostCredentialId?: Hex };
    const name = (body.name ?? "").trim();
    const hostCredentialId = (body.hostCredentialId ?? "") as Hex;
    if (!name || !hostCredentialId) {
      json(res, 400, { error: "invalid" });
      return true;
    }
    const session = pair.create({ name, hostCredentialId });
    json(res, 200, {
      sid: session.sid,
      expiresAt: session.expiresAt,
      joinUrl: `${url.origin}/?pair=${encodeURIComponent(session.sid)}`,
    });
    return true;
  }

  const m = url.pathname.match(/^\/pair\/sessions\/([^/]+)(?:\/(join|grant|finish))?$/);
  if (!m) return false;
  const sid = decodeURIComponent(m[1]!);
  const action = m[2];

  if (req.method === "GET" && !action) {
    const session = pair.get(sid);
    if (!session) {
      json(res, 404, { error: "unknown session" });
      return true;
    }
    json(res, 200, {
      sid: session.sid,
      name: session.name,
      status: session.status,
      guestPub: session.guestPub,
      sealedDek: session.sealedDek,
      expiresAt: session.expiresAt,
    });
    return true;
  }

  if (req.method === "POST" && action === "join") {
    const body = (await readJson(req)) as { guestPub?: Hex };
    if (!body.guestPub) {
      json(res, 400, { error: "invalid" });
      return true;
    }
    const result = pair.join(sid, body.guestPub);
    if ("error" in result) {
      json(res, 400, { error: result.error });
      return true;
    }
    json(res, 200, { status: result.status });
    return true;
  }

  if (req.method === "POST" && action === "grant") {
    const body = (await readJson(req)) as { hostCredentialId?: Hex; sealedDek?: Hex };
    const result = pair.grant(sid, body.hostCredentialId ?? ("" as Hex), body.sealedDek ?? ("" as Hex));
    if ("error" in result) {
      json(res, 400, { error: result.error });
      return true;
    }
    json(res, 200, { status: result.status });
    return true;
  }

  if (req.method === "POST" && action === "finish") {
    const body = (await readJson(req)) as { credentialId?: Hex; wrappedDek?: Hex };
    const session = pair.get(sid);
    if (!session || session.status !== "granted") {
      json(res, 400, { error: "not granted" });
      return true;
    }
    if (!body.credentialId || !body.wrappedDek) {
      json(res, 400, { error: "invalid" });
      return true;
    }
    wraps.set({
      name: session.name,
      credentialId: body.credentialId,
      wrappedDek: body.wrappedDek,
      createdAt: Date.now(),
    });
    pair.markFinished(sid);
    json(res, 200, { name: session.name, ok: true });
    return true;
  }

  return false;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}
