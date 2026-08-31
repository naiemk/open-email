import { useState } from "react";
import type { Meta } from "@/lib/api";
import type { StoredPasskey } from "@/lib/passkeys-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  meta: Meta;
  error: string;
  busy: boolean;
  passkeys: StoredPasskey[];
  turnstileSlot: React.ReactNode;
  onSignUp: (oeId: string) => void;
  onConnect: () => void;
  onConnectStored: (credentialId: string, oeId: string) => void;
  onAddDevice: () => void;
};

export function LandingPage({
  meta,
  error,
  busy,
  passkeys,
  turnstileSlot,
  onSignUp,
  onConnect,
  onConnectStored,
  onAddDevice,
}: Props) {
  const [oeId, setOeId] = useState("");
  const [signInOpen, setSignInOpen] = useState(false);
  const preview = `${oeId.trim() || "you"}@${meta.domain}`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f4f1fb] to-[#ebe6f5]">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="text-lg font-bold text-accent">{meta.domain}</div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-8 px-6 pb-16 md:grid-cols-[1.1fr_0.9fr]">
        <section>
          <h1 className="text-3xl font-bold leading-tight text-accent md:text-4xl">
            Encrypted mail bound to your name, not this server.
          </h1>
          <p className="mt-4 max-w-xl text-muted-foreground">
            Pick an OE id, sign up with a passkey, pay once for registry + storage, then this node opts you in. No password.
          </p>
        </section>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Create your mailbox</CardTitle>
              <CardDescription>Sign up with a passkey — your device holds the keys.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div>
                <Label htmlFor="oe-id">OE id</Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    id="oe-id"
                    value={oeId}
                    onChange={(e) => setOeId(e.target.value)}
                    placeholder="alice"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <span className="whitespace-nowrap text-sm font-semibold text-primary">@{meta.domain}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{preview}</p>
              </div>
              {turnstileSlot}
              <Button className="w-full" disabled={busy || !oeId.trim()} onClick={() => onSignUp(oeId.trim())}>
                Sign up with passkey
              </Button>
              {passkeys.length === 0 ? null : (
                <p className="text-center text-xs text-muted-foreground">or use a passkey you already created here</p>
              )}
              <div className="space-y-2">
                {passkeys.map((p) => (
                  <button
                    key={p.credentialId}
                    type="button"
                    disabled={busy}
                    className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => onConnectStored(p.credentialId, p.oeId)}
                  >
                    <span>{p.label}</span>
                    <span className="text-xs text-muted-foreground">Connect</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="outline" disabled={busy} onClick={() => setSignInOpen(true)}>
                  Sign in with passkey
                </Button>
                <Button variant="ghost" disabled={busy} onClick={onAddDevice}>
                  Add device to another account
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">The only mailbox with</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>On-chain name you own — portable across nodes</p>
              <p>Passkey + PRF — no password, keys stay on device</p>
              <p>Sealed blobs — node stores ciphertext, you decrypt locally</p>
              <p>Opt-in per node — you choose which provider receives mail</p>
            </CardContent>
          </Card>
        </div>
      </main>
      {signInOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md shadow-xl">
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>Use a passkey already on this device (including iCloud Keychain).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full" disabled={busy} onClick={() => { setSignInOpen(false); onConnect(); }}>
                Connect our passkey
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setSignInOpen(false)}>
                Cancel
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
