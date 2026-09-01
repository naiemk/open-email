import { Button } from "@/components/ui/button";
import type { Meta } from "@/lib/api";
import type { Session } from "@/App";
import { PairQrModal } from "@/modals/PairQrModal";
import { useState } from "react";

type Props = {
  meta: Meta;
  session: Session;
  storage: { total_size: number; cap: number };
  onBack: () => void;
  onLogout: () => void;
  onOptToggle: () => void;
  optPending?: boolean;
  onSessionUpdate: (patch: Partial<Session>) => void;
};

export function SettingsPage({ meta, session, storage, onBack, onLogout, onOptToggle, optPending = false }: Props) {
  const [pairQrOpen, setPairQrOpen] = useState(false);
  const pct = storage.cap ? Math.round((storage.total_size / storage.cap) * 100) : 0;

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f1fb] md:flex-row">
      <aside className="shrink-0 border-b border-border bg-[#1b1330] p-4 text-[#e9e4ff] md:w-[240px] md:border-b-0">
        <Button variant="ghost" className="mb-4 w-full justify-start text-[#e9e4ff] hover:bg-white/10" onClick={onBack}>
          ← Inbox
        </Button>
        <nav className="flex gap-2 overflow-x-auto text-sm md:block md:space-y-1 md:overflow-visible">
          <div className="shrink-0 rounded-lg bg-white/10 px-3 py-2 md:shrink">Account</div>
          <div className="shrink-0 px-3 py-2 opacity-70 md:shrink">Recovery</div>
          <div className="shrink-0 px-3 py-2 opacity-70 md:shrink">Security</div>
          <div className="shrink-0 px-3 py-2 opacity-70 md:shrink">Devices</div>
        </nav>
      </aside>
      <main className="flex-1 p-4 md:p-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-2 max-w-xl text-muted-foreground">
          Manage opt-in, storage, and device pairing for {session.oeId}@{meta.domain}.
        </p>
        <div className="mt-6 max-w-lg space-y-4">
          <section className="rounded-xl border border-border bg-white p-5">
            <h2 className="font-semibold">Receiving mail on this node</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Opted in: <strong>{session.optedIn ? "yes" : "no"}</strong>
            </p>
            <Button className="mt-3" disabled={optPending} onClick={onOptToggle}>
              {optPending ? "Working…" : session.optedIn ? "Opt out" : "Opt in"}
            </Button>
          </section>
          <section className="rounded-xl border border-border bg-white p-5">
            <h2 className="font-semibold">Add another device</h2>
            <p className="mt-1 text-sm text-muted-foreground">Show a QR code to pair a new passkey on another device.</p>
            <Button variant="outline" className="mt-3" onClick={() => setPairQrOpen(true)}>
              Show pairing QR
            </Button>
          </section>
          <section className="rounded-xl border border-border bg-white p-5">
            <h2 className="font-semibold">Storage</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {storage.total_size.toLocaleString()} / {storage.cap.toLocaleString()} bytes ({pct}%)
            </p>
            <div className="mt-2 h-2 rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </section>
          <Button variant="outline" onClick={onLogout}>
            Sign out
          </Button>
        </div>
        <PairQrModal
          open={pairQrOpen}
          name={session.name}
          credentialId={session.credentialId}
          dekPrivate={session.dekPrivate}
          onClose={() => setPairQrOpen(false)}
        />
      </main>
    </div>
  );
}
