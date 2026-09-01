import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { bytesToHex, hexToBytes } from "viem";
import {
  assertWebAuthn,
  abortPasskeyCeremony,
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
import { findPasskey, listPasskeys, rememberPasskey, removePasskey, touchPasskey } from "@/lib/passkeys-store";
import {
  clearSignupDraft,
  loadSignupDraft,
  loadSignupDraftByInvoice,
  saveSignupDraft,
} from "@/lib/signup-draft";
import { seedMockPasskey } from "@/lib/webauthn-mock";
import { LandingPage } from "@/screens/LandingPage";
import { InboxPage } from "@/screens/InboxPage";
import { PayModal } from "@/modals/PayModal";
import { RecoveryModal } from "@/modals/RecoveryModal";
import { PairScanModal } from "@/modals/PairScanModal";
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
    const paid = params.get("paid") === "1";
    if (signupId) {
      void resumeFromInvoice(signupId, paid);
    }
  }, []);

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
      history.replaceState({}, "", location.pathname);
    } catch {
      /* ignore stale redirect */
    }
  };

  useEffect(() => {
    if (signup) saveSignupDraft(signup);
  }, [signup]);

  useEffect(() => {
    if (!meta?.turnstileSiteKey || meta.fakeCheckout || !turnstileRef.current) return;
    const api = (window as unknown as { turnstile?: { render: (el: HTMLElement, o: object) => void } }).turnstile;
    if (!api) return;
    api.render(turnstileRef.current, {
      sitekey: meta.turnstileSiteKey,
      callback: (token: string) => setTurnstileToken(token),
    });
  }, [meta]);

  const turnstile = () => {
    if (meta?.fakeCheckout) return "ok";
    if (!turnstileToken) throw new Error("Complete the Turnstile check");
    return turnstileToken;
  };

  const run = useCallback(async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(relayerHint(webAuthnUserError(e)));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const signIn = async (credentialId: Hex, oeId: string, kek: Uint8Array) => {
    if (!meta) return;
    const name = registryName(oeId, meta.domain);
    try {
      const boot = await bootstrap(name, credentialId);
      const dekPrivate = unwrapDek(hexToBytes(boot.wrappedDek), kek);
      const in_ = await optedIn(name, meta.nodeKey);
      setSession({ name, oeId, credentialId, dekPrivate, optedIn: in_ });
      clearSignupDraft(credentialId);
      setPhase("inbox");
      return;
    } catch {
      /* not registered — try unpaid signup */
    }
    await resumeUnpaidSignup(credentialId, oeId, kek);
  };

  const resumeUnpaidSignup = async (credentialId: Hex, oeId: string, kek: Uint8Array) => {
    if (!meta) return;
    const local = loadSignupDraft(credentialId);
    const stored = findPasskey(credentialId);
    let qx = local?.qx ?? stored?.qx;
    let qy = local?.qy ?? stored?.qy;
    let remote = await fetchOpenSignup(credentialId);

    // Orphan passkey (pre-draft era): coords were never persisted, so this credential
    // can never call register. Mint a fresh passkey for the same OE id and continue.
    if ((!qx || !qy) && !(remote?.qx && remote?.qy)) {
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
      setSignup(next);
      saveSignupDraft(next);
      setPhase("paying");
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
    setSignup(next);
    saveSignupDraft(next);
    setPhase("paying");
  };

  const onSignUp = (oeId: string) =>
    run(async () => {
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
      setSignup({
        oeId,
        credentialId: mat.credentialId,
        qx: mat.qx,
        qy: mat.qy,
        kek: mat.kek,
        invoiceId: invoice.id,
        payLink: invoice.payLink,
        status: invoice.status,
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
      setPhase("paying");
    });

  const onConnect = () =>
    run(async () => {
      if (!meta) return;
      const { credentialId, kek } = await connectPasskey();
      touchPasskey(credentialId);
      const stored = listPasskeys().find((p) => p.credentialId === credentialId);
      const oeId = stored?.oeId ?? prompt("Enter your OE id")?.trim() ?? "";
      if (!isValidOeId(oeId)) throw new Error("OE id must be at least 5 characters with no dots");
      await signIn(credentialId, oeId, kek);
    });

  const onConnectStored = (credentialId: string, oeId: string) =>
    run(async () => {
      if (!meta) return;
      const cid = credentialId as Hex;
      const { credentialId: got, kek } = await connectPasskey(cid);
      touchPasskey(credentialId);
      await signIn(got, oeId, kek);
    });

  const onDemoSignIn = () =>
    run(async () => {
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
    run(async () => {
      if (!signup || !meta) return;
      const dek = generateDek();
      const wrappedDek = bytesToHex(wrapDek(dek.privateKey, signup.kek));
      const dekPublic = bytesToHex(dek.publicKey);
      const name = registryName(signup.oeId, meta.domain);
      const challenge = await registerChallenge(name, dekPublic, wrappedDek);
      const auth = await assertWebAuthn(challenge, signup.credentialId);
      await registerPaid({
        invoiceId: signup.invoiceId,
        credentialId: signup.credentialId,
        qx: signup.qx,
        qy: signup.qy,
        dekPublic,
        wrappedDek,
        auth,
      });
      const recoveryKek = crypto.getRandomValues(new Uint8Array(32));
      const recoveryWrap = wrapDek(dek.privateKey, recoveryKek);
      setRecovery(encodeRecovery(recoveryKek, recoveryWrap));
      setPendingSession({
        name,
        oeId: signup.oeId,
        credentialId: signup.credentialId,
        dekPrivate: dek.privateKey,
        optedIn: false,
      });
      setPhase("recovery");
    });

  const onRecoverySaved = () =>
    run(async () => {
      if (!signup || !meta || !pendingSession) return;
      const challenge = await optInChallenge(registryName(signup.oeId, meta.domain), meta.nodeKey);
      const auth = await assertWebAuthn(challenge, signup.credentialId);
      await confirmSaved({ invoiceId: signup.invoiceId, credentialId: signup.credentialId, auth });
      setSession({ ...pendingSession, optedIn: true });
      setPendingSession(null);
      clearSignupDraft(signup.credentialId);
      setSignup(null);
      setRecovery("");
      setPhase("inbox");
    });

  const logout = () => {
    abortPasskeyCeremony();
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
          onSessionUpdate={(patch) => setSession((s) => (s ? { ...s, ...patch } : s))}
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
    </>
  );
}
