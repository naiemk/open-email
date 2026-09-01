import { useCallback, useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import type { Meta } from "@/lib/api";
import type { Session } from "@/App";
import { optedIn as fetchOptedIn } from "@/lib/api";
import { assertWebAuthn } from "@/lib/webauthn";
import { PENDING_OPTIN_KEY, saveStoredSession } from "@/lib/session-store";
import { usePendingAction } from "@/lib/use-pending-action";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import {
  decryptRows,
  downloadEml,
  extractEmailAddress,
  fetchIndex,
  fetchLabels,
  forwardSubject,
  isSnoozed,
  isUnread,
  patchMailState,
  quoteForReply,
  replySubject,
  restoreMail,
  type ComposeAttachment,
  type Mail,
  smtpFrom,
} from "@/lib/mail";
import { SidebarNav, type Folder } from "@/components/mail/SidebarNav";
import { MessageList } from "@/components/mail/MessageList";
import { MessageReader } from "@/components/mail/MessageReader";
import { ComposeModal, type ComposeMode } from "@/components/mail/ComposeModal";
import { MailToolbar } from "@/components/mail/MailToolbar";
import { LabelPicker } from "@/components/mail/LabelPicker";
import { MailDetailsModal, MailHeadersModal } from "@/components/mail/MailDetailsModal";
import { SettingsDrawer } from "@/components/mail/SettingsDrawer";
import { SettingsPage } from "@/screens/SettingsPage";
import { ComposeFab } from "@/components/mobile/ComposeFab";
import { MobileMailHeader } from "@/components/mobile/MobileMailHeader";
import { NavDrawer } from "@/components/mobile/NavDrawer";

type Props = {
  meta: Meta;
  session: Session;
  onLogout: () => void;
  onSessionUpdate: (patch: Partial<Session>) => void;
};

type Screen = "mail" | "settings" | "settings-full";

function mailInFolder(m: Mail, folder: Folder, nowSec: number): boolean {
  if (folder === "trash") return m.trashed;
  if (m.trashed) return false;
  if (folder === "inbox") return m.direction === "in" && !m.archived && !m.spam && !isSnoozed(m, nowSec);
  if (folder === "sent") return m.direction === "out";
  if (folder === "starred") return m.starred;
  if (folder === "archive") return m.archived;
  if (folder === "spam") return m.spam;
  return false;
}

export function InboxPage({ meta, session, onLogout, onSessionUpdate }: Props) {
  const [screen, setScreen] = useState<Screen>("mail");
  const [folder, setFolder] = useState<Folder>("inbox");
  const [mails, setMails] = useState<Mail[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedSeqs, setSelectedSeqs] = useState<Set<number>>(new Set());
  const [composing, setComposing] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>("new");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeAttachments, setComposeAttachments] = useState<ComposeAttachment[]>([]);
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const [labelTargetSeqs, setLabelTargetSeqs] = useState<number[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [headersOpen, setHeadersOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [storage, setStorage] = useState({ total_size: 0, cap: 5 * 1024 * 1024, warn: false });
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const { run, isPending } = usePendingAction();
  const [optInReady, setOptInReady] = useState(
    () => sessionStorage.getItem(PENDING_OPTIN_KEY) === "1" && !session.optedIn,
  );
  const isMobile = !useMediaQuery("(min-width: 768px)");
  const [mobilePane, setMobilePane] = useState<"list" | "reader">("list");
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(location.search).get("optin") === "1") {
      history.replaceState({}, "", location.pathname);
    }
  }, []);

  const reloadCore = useCallback(async () => {
    setLoadError("");
    const rows = await fetchIndex(session.name);
    setMails(await decryptRows(session.name, rows, session.dekPrivate));
    setLabels(await fetchLabels(session.name).catch(() => []));
    const st = (await (await fetch(`/storage/${encodeURIComponent(session.name)}`)).json()) as typeof storage;
    setStorage(st);
    onSessionUpdate({ optedIn: await fetchOptedIn(session.name, meta.nodeKey) });
  }, [session, meta.nodeKey, onSessionUpdate]);

  const reload = useCallback(
    () =>
      run("reload", reloadCore).catch((e) => {
        setLoadError(e instanceof Error ? e.message : String(e));
      }),
    [run, reloadCore],
  );

  useEffect(() => {
    void reloadCore().catch((e) => {
      setLoadError(e instanceof Error ? e.message : String(e));
    });
  }, [reloadCore]);

  const nowSec = Math.floor(Date.now() / 1000);
  const visible = useMemo(() => mails.filter((m) => mailInFolder(m, folder, nowSec)), [mails, folder, nowSec]);
  const q = query.trim().toLowerCase();
  const rows = q
    ? visible.filter((m) => `${m.subject}\n${m.body}\n${m.from}`.toLowerCase().includes(q)).slice(0, 100)
    : visible;
  const sel = rows.find((m) => m.seq === selected) ?? rows[0];

  const counts = useMemo(
    () => ({
      inbox: mails.filter((m) => mailInFolder(m, "inbox", nowSec)).length,
      sent: mails.filter((m) => mailInFolder(m, "sent", nowSec)).length,
      starred: mails.filter((m) => mailInFolder(m, "starred", nowSec)).length,
      archive: mails.filter((m) => mailInFolder(m, "archive", nowSec)).length,
      spam: mails.filter((m) => mailInFolder(m, "spam", nowSec)).length,
      trash: mails.filter((m) => mailInFolder(m, "trash", nowSec)).length,
    }),
    [mails, nowSec],
  );
  const unreadInbox = mails.filter((m) => mailInFolder(m, "inbox", nowSec) && isUnread(m)).length;

  const patchSeqs = (seqs: number[], patch: Parameters<typeof patchMailState>[1][number]) =>
    void run("mail", async () => {
      await patchMailState(
        session.name,
        seqs.map((seq) => ({ seq, ...patch })),
      );
      await reloadCore();
      setSelectedSeqs(new Set());
    }).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
    });

  const targetSeqs = () => (selectedSeqs.size > 0 ? [...selectedSeqs] : sel ? [sel.seq] : []);

  const markRead = (read: boolean, seqs = targetSeqs()) => {
    if (!seqs.length) return;
    patchSeqs(seqs, { read });
  };

  const openCompose = (mode: ComposeMode, mail?: Mail) => {
    setComposeMode(mode);
    setComposeAttachments([]);
    setError("");
    if (!mail || mode === "new") {
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
    } else if (mode === "reply") {
      setComposeTo(extractEmailAddress(mail.from));
      setComposeSubject(replySubject(mail.subject));
      setComposeBody(quoteForReply(mail));
    } else if (mode === "replyAll") {
      setComposeTo(extractEmailAddress(mail.from));
      setComposeSubject(replySubject(mail.subject));
      setComposeBody(quoteForReply(mail));
    } else {
      setComposeTo("");
      setComposeSubject(forwardSubject(mail.subject));
      setComposeBody(`\n\n---------- Forwarded message ----------\nFrom: ${mail.from}\nSubject: ${mail.subject}\n\n${mail.body}`);
    }
    setComposing(true);
  };

  const selectMessage = (seq: number) => {
    setSelected(seq);
    if (isMobile) setMobilePane("reader");
    const mail = mails.find((m) => m.seq === seq);
    if (mail && mail.direction === "in" && !mail.read && !mail.trashed) {
      void patchMailState(session.name, [{ seq, read: true }]).then(() => {
        setMails((prev) => prev.map((m) => (m.seq === seq ? { ...m, read: true } : m)));
      });
    }
  };

  const changeFolder = (f: Folder) => {
    setFolder(f);
    setSelectedSeqs(new Set());
    setMobilePane("list");
    setNavOpen(false);
  };

  const send = () =>
    void run("send", async () => {
      setError("");
      const to = composeTo.trim();
      if (!to || !to.includes("@")) {
        setError("Enter a valid recipient address");
        return;
      }
      const res = await fetch("/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: session.name,
          to,
          subject: composeSubject,
          body: composeBody,
          attachments: composeAttachments.length ? composeAttachments : undefined,
          turnstile: meta.fakeCheckout || meta.disableTurnstile ? "ok" : "",
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
      setComposeAttachments([]);
      setFolder("sent");
      await reloadCore();
    });

  const completeOptIn = () =>
    void run("opt", async () => {
      setError("");
      const ch = (
        (await (
          await fetch(
            `/api/opt-in-challenge?name=${encodeURIComponent(session.name)}&nodeKey=${meta.nodeKey}`,
          )
        ).json()) as { challenge: Hex }
      ).challenge;
      const auth = await assertWebAuthn(ch, session.credentialId);
      await fetch("/api/opt-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: session.name, nodeKey: meta.nodeKey, auth }),
      });
      sessionStorage.removeItem(PENDING_OPTIN_KEY);
      setOptInReady(false);
      onSessionUpdate({ optedIn: true });
    }).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
    });

  const optToggle = () => {
    if (session.optedIn) {
      void run("opt", async () => {
        setError("");
        const ch = (
          (await (
            await fetch(
              `/api/opt-out-challenge?name=${encodeURIComponent(session.name)}&nodeKey=${meta.nodeKey}`,
            )
          ).json()) as { challenge: Hex }
        ).challenge;
        const auth = await assertWebAuthn(ch, session.credentialId);
        await fetch("/api/opt-out", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: session.name, nodeKey: meta.nodeKey, auth }),
        });
        onSessionUpdate({ optedIn: false });
      }).catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      });
      return;
    }
    if (optInReady || sessionStorage.getItem(PENDING_OPTIN_KEY) === "1") {
      completeOptIn();
      return;
    }
    saveStoredSession(session);
    sessionStorage.setItem(PENDING_OPTIN_KEY, "1");
    location.assign(`${location.pathname}?optin=1`);
  };

  const openLabels = (seqs: number[]) => {
    setLabelTargetSeqs(seqs);
    setLabelPickerOpen(true);
  };

  if (screen === "settings-full") {
    return (
      <SettingsPage
        meta={meta}
        session={session}
        storage={storage}
        onBack={() => setScreen("mail")}
        onLogout={onLogout}
        onOptToggle={optToggle}
        optPending={isPending("opt")}
        onSessionUpdate={onSessionUpdate}
      />
    );
  }

  const pct = storage.cap ? Math.min(100, Math.round((storage.total_size / storage.cap) * 100)) : 0;
  const allSelected = rows.length > 0 && rows.every((m) => selectedSeqs.has(m.seq));
  const someSelected = rows.some((m) => selectedSeqs.has(m.seq));

  return (
    <div className="flex h-screen flex-col bg-[#f4f1fb]">
      <MobileMailHeader
        folder={folder}
        searchOpen={searchOpen}
        avatarInitial={session.oeId[0]?.toUpperCase() ?? "?"}
        onMenuOpen={() => setNavOpen(true)}
        onSearchToggle={() => setSearchOpen((v) => !v)}
        onSettings={() => setSettingsOpen(true)}
      />
      <header className="hidden items-center justify-between border-b border-border bg-white px-4 py-2 md:flex">
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
          <button type="button" className="ml-3 underline disabled:opacity-50" disabled={isPending("reload")} onClick={() => reload()}>
            {isPending("reload") ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : null}
      {optInReady && !session.optedIn ? (
        <div className="flex items-center justify-between gap-3 border-b border-primary/20 bg-primary/5 px-4 py-2 text-sm">
          <span>Opt in to receive mail on this node — confirm with your passkey.</span>
          <button
            type="button"
            className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            disabled={isPending("opt")}
            onClick={completeOptIn}
          >
            {isPending("opt") ? "Waiting…" : "Opt in"}
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
      ) : null}
      {toast ? (
        <div className="border-b border-border bg-white px-4 py-2 text-sm">{toast}</div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1">
        <SidebarNav
          domain={meta.domain}
          oeId={session.oeId}
          folder={folder}
          counts={counts}
          unreadInbox={unreadInbox}
          storagePct={pct}
          refreshPending={isPending("reload")}
          onFolder={changeFolder}
          onRefresh={() => reload()}
          onCompose={() => openCompose("new")}
          onSettings={() => setSettingsOpen(true)}
          onFullSettings={() => setScreen("settings-full")}
        />
        <NavDrawer open={navOpen} onClose={() => setNavOpen(false)}>
          <SidebarNav
            variant="drawer"
            domain={meta.domain}
            oeId={session.oeId}
            folder={folder}
            counts={counts}
            unreadInbox={unreadInbox}
            storagePct={pct}
            refreshPending={isPending("reload")}
            onFolder={changeFolder}
            onRefresh={() => reload()}
            onCompose={() => {
              setNavOpen(false);
              openCompose("new");
            }}
            onSettings={() => {
              setNavOpen(false);
              setSettingsOpen(true);
            }}
            onFullSettings={() => {
              setNavOpen(false);
              setScreen("settings-full");
            }}
            onNavigate={() => setNavOpen(false)}
          />
        </NavDrawer>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MailToolbar
            allSelected={allSelected}
            someSelected={someSelected}
            pending={isPending("mail")}
            onSelectAll={(checked) => setSelectedSeqs(checked ? new Set(rows.map((m) => m.seq)) : new Set())}
            onMarkRead={() => markRead(true)}
            onMarkUnread={() => markRead(false)}
            onTrash={() => patchSeqs(targetSeqs(), { trashed: true })}
            onArchive={() => patchSeqs(targetSeqs(), { archived: true, spam: false })}
            onSpam={() => patchSeqs(targetSeqs(), { spam: true, archived: false })}
            onMoveInbox={() => patchSeqs(targetSeqs(), { archived: false, spam: false, trashed: false })}
            onLabels={() => openLabels(targetSeqs())}
            onSnooze={(until) => patchSeqs(targetSeqs(), { snoozeUntil: until })}
          />
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden md:contents">
            <div
              className={cn(
                "pane-slide flex h-full w-[200%] md:h-auto md:min-h-0 md:w-auto md:flex-1 md:translate-x-0",
                mobilePane === "reader" ? "-translate-x-1/2" : "translate-x-0",
              )}
            >
              <div className="flex h-full w-1/2 min-w-0 md:h-auto md:w-auto md:flex-none">
                <MessageList
                  rows={rows}
                  selected={sel?.seq ?? null}
                  selectedSeqs={selectedSeqs}
                  query={query}
                  searchOpen={searchOpen}
                  onQuery={setQuery}
                  onSelect={selectMessage}
                  onToggleSelect={(seq, checked) =>
                    setSelectedSeqs((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(seq);
                      else next.delete(seq);
                      return next;
                    })
                  }
                  onStar={(seq, starred) => patchSeqs([seq], { starred })}
                />
              </div>
              <div className="flex h-full w-1/2 min-w-0 md:h-auto md:flex-1">
                <MessageReader
                  mail={sel}
                  folder={folder}
                  pending={isPending("mail")}
                  onBack={isMobile ? () => setMobilePane("list") : undefined}
                  onMarkRead={(unread) => markRead(!unread, sel ? [sel.seq] : [])}
                  onTrash={() => sel && patchSeqs([sel.seq], { trashed: true })}
                  onRestore={() => {
                    if (!sel) return;
                    void run("mail", async () => {
                      await restoreMail(session.name, sel.seq);
                      await reloadCore();
                    });
                  }}
                  onArchive={() => sel && patchSeqs([sel.seq], { archived: true, spam: false })}
                  onSpam={() => sel && patchSeqs([sel.seq], { spam: true, archived: false })}
                  onMoveInbox={() => sel && patchSeqs([sel.seq], { archived: false, spam: false, trashed: false })}
                  onStar={(starred) => sel && patchSeqs([sel.seq], { starred })}
                  onLabels={() => sel && openLabels([sel.seq])}
                  onExport={() => sel && downloadEml(sel.rawRfc822, sel.subject)}
                  onPrint={() => window.print()}
                  onViewDetails={() => setDetailsOpen(true)}
                  onViewHeaders={() => setHeadersOpen(true)}
                  onReportPhishing={() => {
                    if (!sel) return;
                    patchSeqs([sel.seq], { spam: true });
                    setToast("Message moved to spam.");
                    setTimeout(() => setToast(""), 3000);
                  }}
                  onReply={() => sel && openCompose("reply", sel)}
                  onReplyAll={() => sel && openCompose("replyAll", sel)}
                  onForward={() => sel && openCompose("forward", sel)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      {!composing ? <ComposeFab disabled={isPending("send")} onClick={() => openCompose("new")} /> : null}
      <ComposeModal
        open={composing}
        mode={composeMode}
        from={smtpFrom(meta.domain, session.name)}
        to={composeTo}
        subject={composeSubject}
        body={composeBody}
        attachments={composeAttachments}
        error={error}
        pending={isPending("send")}
        onTo={setComposeTo}
        onSubject={setComposeSubject}
        onBody={setComposeBody}
        onAttachments={setComposeAttachments}
        onSend={send}
        onClose={() => {
          if (isPending("send")) return;
          setComposing(false);
        }}
      />
      <LabelPicker
        open={labelPickerOpen}
        labels={[...new Set([...labels, ...(sel?.labels ?? [])])]}
        selected={sel && labelTargetSeqs.length === 1 && labelTargetSeqs[0] === sel.seq ? sel.labels : []}
        onClose={() => setLabelPickerOpen(false)}
        onApply={(picked) => {
          patchSeqs(labelTargetSeqs, { labels: picked });
          setLabelPickerOpen(false);
        }}
      />
      <MailDetailsModal open={detailsOpen} mail={sel ?? null} onClose={() => setDetailsOpen(false)} />
      <MailHeadersModal open={headersOpen} rawRfc822={sel?.rawRfc822 ?? ""} onClose={() => setHeadersOpen(false)} />
      <SettingsDrawer
        open={settingsOpen}
        optedIn={session.optedIn}
        storage={storage}
        onClose={() => setSettingsOpen(false)}
        onOptToggle={optToggle}
        optPending={isPending("opt")}
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
