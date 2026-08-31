import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { bytesToHex, hexToBytes } from "viem";
import { assertWebAuthn, connectPasskey, createPasskey, encodeRecovery, generateDek, isValidOeId, registryName, unwrapDek, webAuthnUserError, wrapDek } from "@/lib/webauthn";
import {
  bootstrap,
  confirmSaved,
  createInvoice,
  fetchMeta,
  optInChallenge,
  optedIn,
  pollInvoice,
  registerChallenge,
  registerPaid,
  type Meta,
} from "@/lib/api";
import { listPasskeys, rememberPasskey, touchPasskey } from "@/lib/passkeys-store";
import { LandingPage } from "@/screens/LandingPage";
import { InboxPage } from "@/screens/InboxPage";
import { PayModal } from "@/modals/PayModal";
import { RecoveryModal } from "@/modals/RecoveryModal";
import { PairScanModal } from "@/modals/PairScanModal";

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

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [signup, setSignup] = useState<SignupState | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [recovery, setRecovery] = useState("");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [pairScanOpen, setPairScanOpen] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchMeta().then(setMeta).catch((e) => setError(String(e)));
    const params = new URLSearchParams(location.search);
    if (params.get("pair")) setPairScanOpen(true);
  }, []);

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
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(webAuthnUserError(e));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const onSignUp = (oeId: string) =>
    run(async () => {
      if (!meta) return;
      if (!isValidOeId(oeId)) throw new Error("OE id must be at least 5 characters with no dots");
      const mat = await createPasskey(oeId, meta.domain);
      rememberPasskey({ credentialId: mat.credentialId, oeId, label: `${oeId}@${meta.domain}`, lastUsed: Date.now() });
      const invoice = await createInvoice({ credentialId: mat.credentialId, oeId, turnstile: turnstile() });
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
      setPayOpen(true);
    });

  const onConnect = () =>
    run(async () => {
      if (!meta) return;
      const { credentialId, kek } = await connectPasskey();
      touchPasskey(credentialId);
      const stored = listPasskeys().find((p) => p.credentialId === credentialId);
      const oeId = stored?.oeId ?? prompt("Enter your OE id")?.trim() ?? "";
      if (!isValidOeId(oeId)) throw new Error("OE id must be at least 5 characters with no dots");
      const name = registryName(oeId, meta.domain);
      const boot = await bootstrap(name, credentialId);
      const dekPrivate = unwrapDek(hexToBytes(boot.wrappedDek), kek);
      const in_ = await optedIn(name, meta.nodeKey);
      setSession({ name, oeId, credentialId, dekPrivate, optedIn: in_ });
    });

  const onConnectStored = (credentialId: string, oeId: string) =>
    run(async () => {
      if (!meta) return;
      const { credentialId: cid, kek } = await connectPasskey();
      if (cid.toLowerCase() !== credentialId.toLowerCase()) throw new Error("Wrong passkey selected");
      touchPasskey(credentialId);
      const name = registryName(oeId, meta.domain);
      const boot = await bootstrap(name, cid);
      const dekPrivate = unwrapDek(hexToBytes(boot.wrappedDek), kek);
      setSession({ name, oeId, credentialId: cid, dekPrivate, optedIn: await optedIn(name, meta.nodeKey) });
    });

  const onPaidRegister = () =>
    run(async () => {
      if (!signup || !meta) return;
      const dek = generateDek();
      const wrappedDek = bytesToHex(wrapDek(dek.privateKey, signup.kek));
      const dekPublic = bytesToHex(dek.publicKey);
      const name = registryName(signup.oeId, meta.domain);
      const challenge = await registerChallenge(name, dekPublic, wrappedDek);
      const auth = await assertWebAuthn(challenge);
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
      setRecoveryOpen(true);
      setSession({
        name,
        oeId: signup.oeId,
        credentialId: signup.credentialId,
        dekPrivate: dek.privateKey,
        optedIn: false,
      });
    });

  const onRecoverySaved = () =>
    run(async () => {
      if (!signup || !meta) return;
      const challenge = await optInChallenge(registryName(signup.oeId, meta.domain), meta.nodeKey);
      const auth = await assertWebAuthn(challenge);
      await confirmSaved({ invoiceId: signup.invoiceId, credentialId: signup.credentialId, auth });
      setRecoveryOpen(false);
      setPayOpen(false);
      setSignup(null);
      setRecovery("");
      setSession((s) => (s ? { ...s, optedIn: true } : s));
    });

  if (!meta) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }

  if (session) {
    return (
      <InboxPage
        meta={meta}
        session={session}
        onLogout={() => setSession(null)}
        onSessionUpdate={(patch) => setSession((s) => (s ? { ...s, ...patch } : s))}
      />
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
      />
      <PayModal
        open={payOpen}
        meta={meta}
        signup={signup}
        error={error}
        busy={busy}
        onClose={() => setPayOpen(false)}
        onPoll={() => signup && pollInvoice(signup.invoiceId)}
        onRegister={onPaidRegister}
        onStatus={(status) => signup && setSignup({ ...signup, status })}
      />
      <RecoveryModal open={recoveryOpen} secret={recovery} onSaved={onRecoverySaved} busy={busy} />
      <PairScanModal
        open={pairScanOpen}
        meta={meta}
        onClose={() => setPairScanOpen(false)}
        onDone={(s) => {
          setPairScanOpen(false);
          setSession(s);
        }}
      />
    </>
  );
}
