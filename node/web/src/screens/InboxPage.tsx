import { useCallback, useEffect, useState } from "react";
import type { Hex } from "viem";
import type { Meta } from "@/lib/api";
import type { Session } from "@/App";
import { optedIn as fetchOptedIn } from "@/lib/api";
import { assertWebAuthn } from "@/lib/webauthn";
import { decryptRows, fetchIndex, type Mail, smtpFrom } from "@/lib/mail";
import { SidebarNav, type Folder } from "@/components/mail/SidebarNav";
import { MessageList } from "@/components/mail/MessageList";
import { MessageReader } from "@/components/mail/MessageReader";
import { ComposeModal } from "@/components/mail/ComposeModal";
import { SettingsDrawer } from "@/components/mail/SettingsDrawer";
import { SettingsPage } from "@/screens/SettingsPage";

type Props = {
  meta: Meta;
  session: Session;
  onLogout: () => void;
  onSessionUpdate: (patch: Partial<Session>) => void;
};

type Screen = "mail" | "settings" | "settings-full";

export function InboxPage({ meta, session, onLogout, onSessionUpdate }: Props) {
  const [screen, setScreen] = useState<Screen>("mail");
  const [folder, setFolder] = useState<Folder>("inbox");
  const [mails, setMails] = useState<Mail[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [storage, setStorage] = useState({ total_size: 0, cap: 5 * 1024 * 1024, warn: false });
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");

  const reload = useCallback(async () => {
    setLoadError("");
    try {
      const rows = await fetchIndex(session.name);
      setMails(await decryptRows(session.name, rows, session.dekPrivate));
      const st = (await (await fetch(`/storage/${encodeURIComponent(session.name)}`)).json()) as typeof storage;
      setStorage(st);
      onSessionUpdate({ optedIn: await fetchOptedIn(session.name, meta.nodeKey) });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
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
  const rows = q
    ? visible.filter((m) => `${m.subject}\n${m.body}\n${m.from}`.toLowerCase().includes(q)).slice(0, 100)
    : visible;
  const sel = rows.find((m) => m.seq === selected) ?? rows[0];

  const counts = {
    inbox: mails.filter((m) => m.direction === "in" && !m.trashed).length,
    sent: mails.filter((m) => m.direction === "out" && !m.trashed).length,
    trash: mails.filter((m) => m.trashed).length,
  };

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

  const optToggle = async () => {
    const in_ = !session.optedIn;
    const path = in_ ? "/api/opt-in" : "/api/opt-out";
    const challengePath = in_ ? "/api/opt-in-challenge" : "/api/opt-out-challenge";
    const ch = ((await (await fetch(`${challengePath}?name=${encodeURIComponent(session.name)}&nodeKey=${meta.nodeKey}`)).json()) as { challenge: Hex }).challenge;
    const auth = await assertWebAuthn(ch, session.credentialId);
    await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: session.name, nodeKey: meta.nodeKey, auth }),
    });
    onSessionUpdate({ optedIn: in_ });
  };

  if (screen === "settings-full") {
    return (
      <SettingsPage
        meta={meta}
        session={session}
        storage={storage}
        onBack={() => setScreen("mail")}
        onLogout={onLogout}
        onOptToggle={() => void optToggle()}
        onSessionUpdate={onSessionUpdate}
      />
    );
  }

  const pct = storage.cap ? Math.min(100, Math.round((storage.total_size / storage.cap) * 100)) : 0;

  return (
    <div className="flex h-screen flex-col bg-[#f4f1fb]">
      <header className="flex items-center justify-between border-b border-border bg-white px-4 py-2">
        <span className="text-sm font-medium text-muted-foreground">{session.oeId}@{meta.domain}</span>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            {session.optedIn ? "Opted in" : "Not opted in"}
          </span>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white"
            onClick={() => setSettingsOpen(true)}
          >
            {session.oeId[0]?.toUpperCase() ?? "?"}
          </button>
        </div>
      </header>
      {loadError ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {loadError}
          <button type="button" className="ml-3 underline" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <SidebarNav
          domain={meta.domain}
          folder={folder}
          counts={counts}
          storagePct={pct}
          onFolder={setFolder}
          onCompose={() => setComposing(true)}
          onSettings={() => setSettingsOpen(true)}
          onFullSettings={() => setScreen("settings-full")}
        />
        <MessageList rows={rows} selected={sel?.seq ?? null} query={query} onQuery={setQuery} onSelect={setSelected} />
        <MessageReader
          mail={sel}
          folder={folder}
          onTrash={async () => {
            if (!sel) return;
            await fetch(`/trash/${encodeURIComponent(session.name)}/${sel.seq}`, { method: "POST" });
            await reload();
          }}
        />
      </div>
      <ComposeModal
        open={composing}
        from={smtpFrom(meta.domain, session.name)}
        to={composeTo}
        subject={composeSubject}
        body={composeBody}
        error={error}
        onTo={setComposeTo}
        onSubject={setComposeSubject}
        onBody={setComposeBody}
        onSend={() => void send()}
        onClose={() => setComposing(false)}
      />
      <SettingsDrawer
        open={settingsOpen}
        optedIn={session.optedIn}
        storage={storage}
        onClose={() => setSettingsOpen(false)}
        onOptToggle={() => void optToggle()}
        onAddDevice={() => {
          setSettingsOpen(false);
          setScreen("settings-full");
        }}
        onFullSettings={() => {
          setSettingsOpen(false);
          setScreen("settings-full");
        }}
        onLogout={onLogout}
      />
    </div>
  );
}
