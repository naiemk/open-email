import { Button } from "@/components/ui/button";
import type { Meta } from "@/lib/api";
import type { Session } from "@/App";
import { PairQrModal } from "@/modals/PairQrModal";
import { ConnectServiceModal } from "@/modals/ConnectServiceModal";
import { LanguagePicker } from "@/i18n/LanguagePicker";
import { useI18n, useT } from "@/i18n/I18nProvider";
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
  const t = useT();
  const { intlLocale } = useI18n();
  const [pairQrOpen, setPairQrOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const pct = storage.cap ? Math.round((storage.total_size / storage.cap) * 100) : 0;

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f1fb] md:flex-row">
      <aside className="shrink-0 border-b border-border bg-[#1b1330] p-4 text-[#e9e4ff] md:w-[240px] md:border-b-0">
        <Button variant="ghost" className="mb-4 w-full justify-start text-[#e9e4ff] hover:bg-white/10" onClick={onBack}>
          {t("settings.inboxBack")}
        </Button>
        <nav className="flex gap-2 overflow-x-auto text-sm md:block md:space-y-1 md:overflow-visible">
          <div className="shrink-0 rounded-lg bg-white/10 px-3 py-2 md:shrink">{t("settings.account")}</div>
          <div className="shrink-0 px-3 py-2 opacity-70 md:shrink">{t("settings.recovery")}</div>
          <div className="shrink-0 px-3 py-2 opacity-70 md:shrink">{t("settings.security")}</div>
          <div className="shrink-0 px-3 py-2 opacity-70 md:shrink">{t("settings.devices")}</div>
        </nav>
      </aside>
      <main className="flex-1 p-4 md:p-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
          <LanguagePicker />
        </div>
        <p className="mt-2 max-w-xl text-muted-foreground">
          {t("settings.manageDesc", { address: `${session.oeId}@${meta.domain}` })}
        </p>
        <div className="mt-6 max-w-lg space-y-4">
          <section className="rounded-xl border border-border bg-white p-5">
            <h2 className="font-semibold">{t("settings.receivingMail")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.optedInLabel")}{" "}
              <strong>{session.optedIn ? t("common.yes") : t("common.no")}</strong>
            </p>
            <Button className="mt-3" disabled={optPending} onClick={onOptToggle}>
              {optPending ? t("common.working") : session.optedIn ? t("mail.optOut") : t("mail.optIn")}
            </Button>
          </section>
          <section className="rounded-xl border border-border bg-white p-5">
            <h2 className="font-semibold">{t("settings.connectService")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("settings.connectServiceDesc")}</p>
            <Button variant="outline" className="mt-3" onClick={() => setConnectOpen(true)}>
              {t("settings.connectAnother")}
            </Button>
          </section>
          <section className="rounded-xl border border-border bg-white p-5">
            <h2 className="font-semibold">{t("settings.addDevice")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("settings.addDeviceDesc")}</p>
            <Button variant="outline" className="mt-3" onClick={() => setPairQrOpen(true)}>
              {t("settings.showPairingQr")}
            </Button>
          </section>
          <section className="rounded-xl border border-border bg-white p-5">
            <h2 className="font-semibold">{t("mail.storage")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("mail.bytesUsed", {
                used: storage.total_size.toLocaleString(intlLocale),
                cap: storage.cap.toLocaleString(intlLocale),
                pct,
              })}
            </p>
            <div className="mt-2 h-2 rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </section>
          <Button variant="outline" onClick={onLogout}>
            {t("settings.signOut")}
          </Button>
        </div>
        <PairQrModal
          open={pairQrOpen}
          name={session.name}
          credentialId={session.credentialId}
          dekPrivate={session.dekPrivate}
          onClose={() => setPairQrOpen(false)}
        />
        <ConnectServiceModal
          open={connectOpen}
          meta={meta}
          session={session}
          onClose={() => setConnectOpen(false)}
        />
      </main>
    </div>
  );
}
