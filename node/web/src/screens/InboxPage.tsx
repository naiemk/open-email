import { useCallback, useEffect, useState } from "react";
import { bytesToHex, hexToBytes } from "viem";
import type { Hex } from "viem";
import type { Meta } from "@/lib/api";
import type { Session } from "@/App";
import { optedIn as fetchOptedIn } from "@/lib/api";
import { assertWebAuthn } from "@/lib/webauthn";
import { decryptRows, fetchIndex, type Mail, smtpFrom } from "@/lib/mail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PairQrModal } from "@/modals/PairQrModal";

type Folder = "inbox" | "sent" | "trash";

type Props = {
  meta: Meta;
  session: Session;
  onLogout: () => void;
  onSessionUpdate: (patch: Partial<Session>) => void;
};

export function InboxPage({ meta, session, onLogout, onSessionUpdate }: Props) {
  const [screen, setScreen] = useState<"mail" | "settings">("mail");
  const [folder, setFolder] = useState<Folder>("inbox");
  const [mails, setMails] = useState<Mail[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [storage, setStorage] = useState({ total_size: 0, cap: 5 * 1024 * 1024, warn: false });
  const [pairQrOpen, setPairQrOpen] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const rows = await fetchIndex(session.name);
    setMails(await decryptRows(session.name, rows, session.dekPrivate));
    const st = (await (await fetch(`/storage/${encodeURIComponent(session.name)}`)).json()) as typeof storage;
    setStorage(st);
    onSessionUpdate({ optedIn: await fetchOptedIn(session.name, meta.nodeKey) });
  }, [session, meta.nodeKey, onSessionUpdate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = mails.filter((m) => {
    if (folder === "inbox") return m.direction === "in" && !m.trashed;
    if (folder === "sent") return m.direction === "out" && !m.trashed;
    return m.trashed;
  });
  const q = query.trim().toLowerCase();
  const rows = (q ? visible.filter((m) => `${m.subject}\n${m.body}\n${m.from}`.toLowerCase().includes(q)).slice(0, 100) : visible);
  const sel = rows.find((m) => m.seq === selected) ?? rows[0];

  const send = async () => {
    setError("");
    const res = await fetch("/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: session.name,
        to: composeTo.trim(),
        subject: composeSubject,
        body: composeBody,
        turnstile: meta.fakeCheckout ? "ok" : "",
      }),
    });
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? "send failed");
      return;
    }
    setComposing(false);
    setComposeTo("");
    setComposeSubject("");
    setComposeBody("");
    setFolder("sent");
    await reload();
  };

  const optToggle = async (in_: boolean) => {
    const path = in_ ? "/api/opt-in" : "/api/opt-out";
    const challengePath = in_ ? "/api/opt-in-challenge" : "/api/opt-out-challenge";
    const ch = ((await (await fetch(`${challengePath}?name=${encodeURIComponent(session.name)}&nodeKey=${meta.nodeKey}`)).json()) as { challenge: Hex }).challenge;
    const auth = await assertWebAuthn(ch);
    await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: session.name, nodeKey: meta.nodeKey, auth }),
    });
    onSessionUpdate({ optedIn: in_ });
  };

  if (screen === "settings") {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-8">
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-sm">
          Opted in: <strong>{session.optedIn ? "yes" : "no"}</strong>
        </p>
        <Button onClick={() => void optToggle(!session.optedIn)}>{session.optedIn ? "Opt out" : "Opt in"}</Button>
        <Button variant="outline" onClick={() => setPairQrOpen(true)}>
          Add another device (show QR)
        </Button>
        <p className="text-sm text-muted-foreground">
          Storage {storage.total_size} / {storage.cap} bytes
        </p>
        <Button variant="ghost" onClick={() => setScreen("mail")}>
          Back to mail
        </Button>
        <Button variant="outline" onClick={onLogout}>
          Sign out
        </Button>
        <PairQrModal
          open={pairQrOpen}
          name={session.name}
          credentialId={session.credentialId}
          dekPrivate={session.dekPrivate}
          onClose={() => setPairQrOpen(false)}
        />
      </div>
    );
  }

  const pct = storage.cap ? Math.min(100, Math.round((storage.total_size / storage.cap) * 100)) : 0;

  return (
    <div className="grid h-screen grid-cols-[220px_300px_1fr] bg-background">
      <nav className="flex flex-col gap-1 bg-accent p-4 text-accent-foreground">
        <h1 className="mb-3 text-base font-semibold text-[#c4b5fd]">{meta.domain}</h1>
        <Button className="mb-2 justify-start bg-primary" onClick={() => setComposing(true)}>
          Compose
        </Button>
        {(["inbox", "sent", "trash"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`rounded-lg px-3 py-2 text-left capitalize ${folder === f ? "bg-primary" : "hover:bg-white/10"}`}
            onClick={() => setFolder(f)}
          >
            {f}
          </button>
        ))}
        <button type="button" className="mt-2 rounded-lg px-3 py-2 text-left hover:bg-white/10" onClick={() => setScreen("settings")}>
          Settings
        </button>
        <div className="mt-auto text-xs text-[#c4b5fd]">
          Storage {pct}%
          <div className="mt-1 h-1.5 rounded bg-white/20">
            <div className="h-full rounded bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </nav>
      <div className="overflow-auto border-r border-border bg-card">
        <div className="p-2">
          <Input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {rows.map((m) => (
          <button
            key={m.seq}
            type="button"
            className={`block w-full border-b border-border px-3 py-3 text-left ${sel?.seq === m.seq ? "bg-muted" : "hover:bg-muted/50"}`}
            onClick={() => setSelected(m.seq)}
          >
            <div className="truncate font-medium">{m.subject || "(no subject)"}</div>
            <div className="truncate text-xs text-muted-foreground">{m.from}</div>
          </button>
        ))}
      </div>
      <div className="overflow-auto bg-card p-6">
        {sel ? (
          <>
            <h2 className="text-xl font-semibold">{sel.subject || "(no subject)"}</h2>
            <p className="text-sm text-muted-foreground">{sel.from}</p>
            <pre className="mt-4 whitespace-pre-wrap font-sans text-sm">{sel.body}</pre>
            {folder !== "trash" ? (
              <Button
                variant="outline"
                className="mt-4"
                onClick={async () => {
                  await fetch(`/trash/${encodeURIComponent(session.name)}/${sel.seq}`, { method: "POST" });
                  await reload();
                }}
              >
                Move to trash
              </Button>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground">Select a message</p>
        )}
      </div>
      {composing ? (
        <div className="fixed bottom-6 right-6 w-[420px] space-y-2 rounded-xl border border-border bg-card p-4 shadow-xl">
          <div className="text-sm font-medium">From {smtpFrom(meta.domain, session.name)}</div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Input placeholder="To" value={composeTo} onChange={(e) => setComposeTo(e.target.value)} />
          <Input placeholder="Subject" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
          <Textarea placeholder="Write…" value={composeBody} onChange={(e) => setComposeBody(e.target.value)} />
          <div className="flex gap-2">
            <Button onClick={() => void send()}>Send</Button>
            <Button variant="ghost" onClick={() => setComposing(false)}>
              Discard
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
