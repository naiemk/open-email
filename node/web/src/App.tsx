import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { bytesToHex, hexToBytes } from "viem";
import {
  assertWebAuthn,
  abortPasskeyCeremony,
  awaitPasskeyIdle,
  connectPasskey,
  createPasskey,
  encodeRecovery,
  generateDek,
  isValidOeId,
  registryName,
  setMockPasskeyMode,
  unwrapDek,
  webAuthnUserError,
  wrapDek,
} from "@/lib/webauthn";
import {
  bootstrap,
  confirmSaved,
  createInvoice,
  fetchMeta,
  fetchMockConfig,
  fetchOpenSignup,
  markInvoicePaid,
  optInChallenge,
  optedIn,
  pollInvoice,
  registerChallenge,
  registerPaid,
  type Meta,
} from "@/lib/api";
import { relayerHint } from "@/lib/api-fetch";
import { passkeyLog, passkeyLogError } from "@/lib/passkey-log";
import { findPasskey, listPasskeys, rememberPasskey, removePasskey, touchPasskey } from "@/lib/passkeys-store";
import {
  clearSignupDraft,
  loadSignupDraft,
  loadSignupDraftByInvoice,
  saveSignupDraft,
} from "@/lib/signup-draft";
import {
  clearPendingRecovery,
  loadPendingRecovery,
  savePendingRecovery,
} from "@/lib/pending-recovery";
import {
  clearStoredSession,
  loadStoredSession,
  PENDING_OPTIN_KEY,
  saveStoredSession,
} from "@/lib/session-store";
import { seedMockPasskey } from "@/lib/webauthn-mock";
import { LandingPage } from "@/screens/LandingPage";
import { InboxPage } from "@/screens/InboxPage";
import { PayModal } from "@/modals/PayModal";
import { RecoveryModal } from "@/modals/RecoveryModal";
import { PairScanModal } from "@/modals/PairScanModal";
import { ServicePairOpenModal } from "@/modals/ServicePairOpenModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export type Session = {
  name: string;
  oeId: string;
  credentialId: Hex;
  dekPrivate: Uint8Array;
  optedIn: boolean;
};

export type SignupState = {
  oeId: string;
  credentialId: Hex;
  qx: Hex;
  qy: Hex;
  kek: Uint8Array;
  invoiceId: string;
  payLink: string;
  status: string;
};

type AuthPhase = "landing" | "paying" | "recovery" | "inbox";

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<AuthPhase>("landing");
  const [session, setSession] = useState<Session | null>(null);
  const [signup, setSignup] = useState<SignupState | null>(null);
  const [recovery, setRecovery] = useState("");
  const [pendingSession, setPendingSession] = useState<Session | null>(null);
  const [pairScanOpen, setPairScanOpen] = useState(false);
  const [servicePairOpen, setServicePairOpen] = useState(false);
  const [openExistingOeId, setOpenExistingOeId] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        const m = await fetchMeta();
        setMeta(m);
        const mock = m.mockPasskey || new URLSearchParams(location.search).has("mock");
        setMockPasskeyMode(mock);
        if (mock) {
          const cfg = await fetchMockConfig();
          if (cfg) {
            seedMockPasskey({
              oeId: cfg.oeId,
              credentialId: cfg.credentialId,
              qx: cfg.qx,
              qy: cfg.qy,
              secretHex: cfg.secretHex,
            });
          }
        }
      } catch (e) {
        setError(String(e));
      }
    })();
    const params = new URLSearchParams(location.search);
    if (params.get("pair")) setPairScanOpen(true);
    const signupId = params.get("signup");
    const recoveryId = params.get("recovery");
    const paid = params.get("paid") === "1";
    if (recoveryId) {
      resumeRecovery(recoveryId);
    } else if (signupId) {
      void resumeFromInvoice(signupId, paid);
    } else {
      const stored = loadStoredSession();
      if (stored) {
        setSession(stored);
        setPhase("inbox");
        passkeyLog("boot:restore-session", { oeId: stored.oeId, optedIn: stored.optedIn });
      }
    }
  }, []);

  /** Full navigation clears the browser WebAuthn slot before inbox or opt-in. */
  const enterInbox = (next: Session) => {
    saveStoredSession(next);
    if (!next.optedIn) sessionStorage.setItem(PENDING_OPTIN_KEY, "1");
    passkeyLog("enterInbox:reload", { oeId: next.oeId, optedIn: next.optedIn });
    location.assign(location.pathname);
  };

  /** Reload after on-chain register so opt-in assert is the only WebAuthn call on this page. */
  const redirectToRecovery = (input: {
    invoiceId: string;
    recovery: string;
    name: string;
    oeId: string;
    credentialId: Hex;
    dekPrivate: Uint8Array;
  }) => {
    savePendingRecovery({
      invoiceId: input.invoiceId,
      recovery: input.recovery,
      name: input.name,
      oeId: input.oeId,
      credentialId: input.credentialId,
      dekPrivateHex: bytesToHex(input.dekPrivate),
    });
    passkeyLog("redirectToRecovery", { oeId: input.oeId, invoiceId: input.invoiceId });
    location.assign(`${location.pathname}?recovery=${encodeURIComponent(input.invoiceId)}`);
  };

  const resumeRecovery = (invoiceId: string) => {
    const pending = loadPendingRecovery(invoiceId);
    const draft = loadSignupDraftByInvoice(invoiceId);
    if (!pending || !draft) {
      passkeyLog("resumeRecovery:missing", { invoiceId, hasPending: !!pending, hasDraft: !!draft });
      return;
    }
    setSignup(draft);
    setRecovery(pending.recovery);
    setPendingSession({
      name: pending.name,
      oeId: pending.oeId,
      credentialId: pending.credentialId,
      dekPrivate: hexToBytes(pending.dekPrivateHex),
      optedIn: false,
    });
    setPhase("recovery");
    passkeyLog("resumeRecovery", { oeId: pending.oeId, invoiceId });
    history.replaceState({}, "", location.pathname);
  };

  /** Full navigation clears the browser WebAuthn slot before a later register/assert. */
  const redirectToSignup = (draft: SignupState) => {
    saveSignupDraft(draft);
    passkeyLog("redirectToSignup", { oeId: draft.oeId, invoiceId: draft.invoiceId, status: draft.status });
    location.assign(`${location.pathname}?signup=${encodeURIComponent(draft.invoiceId)}`);
  };

  const resumeFromInvoice = async (invoiceId: string, paidHint: boolean) => {
    try {
      const draft = loadSignupDraftByInvoice(invoiceId);
      if (!draft) return;
      let status = draft.status;
      if (paidHint) status = "paid";
      else status = await pollInvoice(invoiceId);
      const next = { ...draft, invoiceId, status };
      setSignup(next);
      saveSignupDraft(next);
      setPhase("paying");
      passkeyLog("resumeFromInvoice", { oeId: next.oeId, invoiceId, status });
      history.replaceState({}, "", location.pathname);
    } catch {
      /* ignore stale redirect */
    }
  };

  useEffect(() => {
    if (signup) saveSignupDraft(signup);
  }, [signup]);

  useEffect(() => {
    if (!meta?.turnstileSiteKey || meta.fakeCheckout || meta.disableTurnstile || !turnstileRef.current) return;
    const api = (window as unknown as { turnstile?: { render: (el: HTMLElement, o: object) => void } }).turnstile;
    if (!api) return;
    api.render(turnstileRef.current, {
      sitekey: meta.turnstileSiteKey,
      callback: (token: string) => setTurnstileToken(token),
    });
  }, [meta]);

  const turnstile = () => {
    if (meta?.fakeCheckout || meta.disableTurnstile) return "ok";
    if (!turnstileToken) throw new Error("Complete the Turnstile check");
    return turnstileToken;
  };

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    if (busyRef.current) {
      passkeyLog("run:blocked", { label, reason: "busyRef" });
      return;
    }
    passkeyLog("run:start", { label });
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      passkeyLog("run:ok", { label });
    } catch (e) {
      passkeyLogError("run:error", e, { label });
      setError(relayerHint(webAuthnUserError(e)));
    } finally {
      busyRef.current = false;
      setBusy(false);
      passkeyLog("run:done", { label });
    }
  }, []);

  const signIn = async (credentialId: Hex, oeId: string, kek: Uint8Array) => {
    if (!meta) return;
    const name = registryName(oeId, meta.domain);
    passkeyLog("signIn:start", { oeId, credentialId: credentialId.slice(0, 18), name });
    try {
      passkeyLog("signIn:bootstrap-fetch", { name });
      const boot = await bootstrap(name, credentialId);
      const dekPrivate = unwrapDek(hexToBytes(boot.wrappedDek), kek);
      const in_ = await optedIn(name, meta.nodeKey);
      clearSignupDraft(credentialId);
      enterInbox({ name, oeId, credentialId, dekPrivate, optedIn: in_ });
      return;
    } catch {
      passkeyLog("signIn:not-registered-resume", { oeId });
    }
    await resumeUnpaidSignup(credentialId, oeId, kek);
  };

  const resumeUnpaidSignup = async (credentialId: Hex, oeId: string, kek: Uint8Array) => {
    if (!meta) return;
    passkeyLog("resumeUnpaidSignup:start", { oeId, credentialId: credentialId.slice(0, 18) });
    const local = loadSignupDraft(credentialId);
    const stored = findPasskey(credentialId);
    let qx = local?.qx ?? stored?.qx;
    let qy = local?.qy ?? stored?.qy;
    let remote = await fetchOpenSignup(credentialId);

    // Orphan passkey (pre-draft era): coords were never persisted, so this credential
    // can never call register. Mint a fresh passkey for the same OE id and continue.
    if ((!qx || !qy) && !(remote?.qx && remote?.qy)) {
      passkeyLog("resumeUnpaidSignup:orphan-mint-passkey", { oeId });
      const mat = await createPasskey(oeId, meta.domain);
      removePasskey(credentialId);
      rememberPasskey({
        credentialId: mat.credentialId,
        oeId,
        label: `${oeId}@${meta.domain}`,
        lastUsed: Date.now(),
        qx: mat.qx,
        qy: mat.qy,
      });
      const invoice = await createInvoice({
        credentialId: mat.credentialId,
        oeId,
        turnstile: turnstile(),
        qx: mat.qx,
        qy: mat.qy,
      });
      const next: SignupState = {
        oeId,
        credentialId: mat.credentialId,
        qx: mat.qx,
        qy: mat.qy,
        kek: mat.kek,
        invoiceId: invoice.id,
        payLink: invoice.payLink,
        status: invoice.status,
      };
      passkeyLog("resumeUnpaidSignup:paying-after-mint", { oeId, invoiceId: invoice.id });
      redirectToSignup(next);
      return;
    }

    qx = qx ?? remote!.qx!;
    qy = qy ?? remote!.qy!;

    if (!remote) {
      const invoice = await createInvoice({
        credentialId,
        oeId,
        turnstile: turnstile(),
        qx,
        qy,
      });
      remote = {
        id: invoice.id,
        payLink: invoice.payLink,
        status: invoice.status,
        oeId,
        qx: invoice.qx ?? qx,
        qy: invoice.qy ?? qy,
      };
    }

    rememberPasskey({
      credentialId,
      oeId: remote.oeId || oeId,
      label: `${remote.oeId || oeId}@${meta.domain}`,
      lastUsed: Date.now(),
      qx,
      qy,
    });

    const next: SignupState = {
      oeId: remote.oeId || oeId,
      credentialId,
      qx,
      qy,
      kek,
      invoiceId: remote.id,
      payLink: remote.payLink,
      status: remote.status,
    };
    passkeyLog("resumeUnpaidSignup:paying", { oeId, invoiceId: remote.id, status: remote.status });
    redirectToSignup(next);
  };

  const onSignUp = (oeId: string) =>
    run("onSignUp", async () => {
      if (!meta) return;
      if (!isValidOeId(oeId)) throw new Error("OE id must be at least 5 characters with no dots");
      const mat = await createPasskey(oeId, meta.domain);
      rememberPasskey({
        credentialId: mat.credentialId,
        oeId,
        label: `${oeId}@${meta.domain}`,
        lastUsed: Date.now(),
        qx: mat.qx,
        qy: mat.qy,
      });
      const invoice = await createInvoice({
        credentialId: mat.credentialId,
        oeId,
        turnstile: turnstile(),
        qx: mat.qx,
        qy: mat.qy,
      });
      saveSignupDraft({
        oeId,
        credentialId: mat.credentialId,
        qx: mat.qx,
        qy: mat.qy,
        kek: mat.kek,
        invoiceId: invoice.id,
        payLink: invoice.payLink,
        status: invoice.status,
      });
      passkeyLog("onSignUp:reload-for-pay", { invoiceId: invoice.id });
      location.assign(`${location.pathname}?signup=${encodeURIComponent(invoice.id)}`);
    });

  const onConnect = () =>
    run("onConnect", async () => {
      if (!meta) return;
      const { credentialId, kek } = await connectPasskey();
      touchPasskey(credentialId);
      const stored = listPasskeys().find((p) => p.credentialId === credentialId);
      const oeId = stored?.oeId ?? prompt("Enter your OE id")?.trim() ?? "";
      if (!isValidOeId(oeId)) throw new Error("OE id must be at least 5 characters with no dots");
      await signIn(credentialId, oeId, kek);
    });

  const onConnectStored = (credentialId: string, oeId: string) =>
    run("onConnectStored", async () => {
      if (!meta) return;
      const cid = credentialId as Hex;
      passkeyLog("onConnectStored:start", { oeId, credentialId: cid.slice(0, 18) });
      const { credentialId: got, kek } = await connectPasskey(cid);
      touchPasskey(credentialId);
      await signIn(got, oeId, kek);
    });

  const onDemoSignIn = () =>
    run("onDemoSignIn", async () => {
      if (!meta?.mockPasskey) return;
      const cfg = await fetchMockConfig();
      if (!cfg) throw new Error("Demo account not configured on this node");
      seedMockPasskey({
        oeId: cfg.oeId,
        credentialId: cfg.credentialId,
        qx: cfg.qx,
        qy: cfg.qy,
        secretHex: cfg.secretHex,
      });
      rememberPasskey({
        credentialId: cfg.credentialId,
        oeId: cfg.oeId,
        label: `${cfg.oeId}@${meta.domain}`,
        lastUsed: Date.now(),
      });
      const kek = new Uint8Array(32).fill(9);
      await signIn(cfg.credentialId, cfg.oeId, kek);
    });

  const onPaidRegister = () =>
    run("onPaidRegister", async () => {
      if (!signup || !meta) {
        passkeyLog("onPaidRegister:skip", { reason: !signup ? "no-signup" : "no-meta" });
        return;
      }
      passkeyLog("onPaidRegister:start", {
        oeId: signup.oeId,
        credentialId: signup.credentialId.slice(0, 18),
        invoiceId: signup.invoiceId,
        status: signup.status,
      });
      passkeyLog("onPaidRegister:generate-dek");
      const dek = generateDek();
      const wrappedDek = bytesToHex(wrapDek(dek.privateKey, signup.kek));
      const dekPublic = bytesToHex(dek.publicKey);
      const name = registryName(signup.oeId, meta.domain);
      passkeyLog("onPaidRegister:register-challenge-fetch", { name });
      const challenge = await registerChallenge(name, dekPublic, wrappedDek);
      passkeyLog("onPaidRegister:register-challenge-ok", { challengeLen: challenge.length });
      passkeyLog("onPaidRegister:await-passkey-idle");
      await awaitPasskeyIdle();
      passkeyLog("onPaidRegister:assert-webauthn-start", { credentialId: signup.credentialId.slice(0, 18) });
      const auth = await assertWebAuthn(challenge, signup.credentialId);
      passkeyLog("onPaidRegister:assert-webauthn-ok");
      const stored = findPasskey(signup.credentialId);
      const qx = stored?.qx ?? signup.qx;
      const qy = stored?.qy ?? signup.qy;
      if (!qx || !qy) {
        throw new Error("Passkey coordinates missing — remove this stored login and sign up again");
      }
      passkeyLog("onPaidRegister:register-paid-post", { qx: qx.slice(0, 12), qy: qy.slice(0, 12) });
      await registerPaid({
        invoiceId: signup.invoiceId,
        credentialId: signup.credentialId,
        qx,
        qy,
        dekPublic,
        wrappedDek,
        auth,
      });
      const recoveryKek = crypto.getRandomValues(new Uint8Array(32));
      const recoveryWrap = wrapDek(dek.privateKey, recoveryKek);
      redirectToRecovery({
        invoiceId: signup.invoiceId,
        recovery: encodeRecovery(recoveryKek, recoveryWrap),
        name,
        oeId: signup.oeId,
        credentialId: signup.credentialId,
        dekPrivate: dek.privateKey,
      });
    });

  const onRecoverySaved = () =>
    run("onRecoverySaved", async () => {
      if (!signup || !meta || !pendingSession) return;
      passkeyLog("onRecoverySaved:start", { oeId: signup.oeId });
      const challenge = await optInChallenge(registryName(signup.oeId, meta.domain), meta.nodeKey);
      passkeyLog("onRecoverySaved:await-passkey-idle");
      await awaitPasskeyIdle();
      passkeyLog("onRecoverySaved:assert-webauthn-start");
      const auth = await assertWebAuthn(challenge, signup.credentialId);
      passkeyLog("onRecoverySaved:assert-webauthn-ok");
      await confirmSaved({ invoiceId: signup.invoiceId, credentialId: signup.credentialId, auth });
      clearPendingRecovery();
      clearSignupDraft(signup.credentialId);
      setSignup(null);
      setRecovery("");
      setPendingSession(null);
      enterInbox({ ...pendingSession, optedIn: true });
    });

  const logout = () => {
    passkeyLog("logout");
    abortPasskeyCeremony();
    clearPendingRecovery();
    clearStoredSession();
    setSession(null);
    setPendingSession(null);
    setSignup(null);
    setRecovery("");
    setPhase("landing");
    setError("");
  };

  if (!meta) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }

  if (phase === "inbox" && session) {
    return (
      <ErrorBoundary onReset={logout}>
        <InboxPage
          meta={meta}
          session={session}
          onLogout={logout}
          onSessionUpdate={(patch) =>
            setSession((s) => {
              if (!s) return s;
              const next = { ...s, ...patch };
              saveStoredSession(next);
              return next;
            })
          }
        />
      </ErrorBoundary>
    );
  }

  return (
    <>
      <LandingPage
        meta={meta}
        error={error}
        busy={busy}
        passkeys={listPasskeys()}
        turnstileSlot={<div ref={turnstileRef} className="my-3" />}
        onSignUp={onSignUp}
        onConnect={onConnect}
        onConnectStored={onConnectStored}
        onAddDevice={() => setPairScanOpen(true)}
        onOpenExisting={(oeId) => {
          setOpenExistingOeId(oeId);
          setServicePairOpen(true);
        }}
        onDemoSignIn={meta.mockPasskey ? onDemoSignIn : undefined}
      />
      <PayModal
        open={phase === "paying"}
        meta={meta}
        signup={signup}
        error={error}
        busy={busy}
        onClose={() => {
          setPhase("landing");
        }}
        onPoll={async () => {
          if (!signup) throw new Error("No signup in progress");
          return pollInvoice(signup.invoiceId);
        }}
        onMarkPaid={async () => {
          if (!signup) return;
          await markInvoicePaid(signup.invoiceId);
          setSignup({ ...signup, status: "paid" });
        }}
        onRegister={onPaidRegister}
        onStatus={(status) => signup && setSignup({ ...signup, status })}
      />
      <RecoveryModal
        open={phase === "recovery"}
        secret={recovery}
        error={error}
        onSaved={onRecoverySaved}
        busy={busy}
      />
      <PairScanModal
        open={pairScanOpen}
        meta={meta}
        onClose={() => setPairScanOpen(false)}
        onDone={(s) => {
          setPairScanOpen(false);
          setSession(s);
          setPhase("inbox");
        }}
      />
      <ServicePairOpenModal
        open={servicePairOpen}
        meta={meta}
        initialOeId={openExistingOeId}
        onClose={() => setServicePairOpen(false)}
        onDone={(s) => {
          setServicePairOpen(false);
          enterInbox(s);
        }}
      />
    </>
  );
}
