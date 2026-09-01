import { Button } from "@/components/ui/button";
import { LanguagePicker } from "@/i18n/LanguagePicker";
import { useI18n, useT } from "@/i18n/I18nProvider";

type Props = {
  open: boolean;
  optedIn: boolean;
  storage: { total_size: number; cap: number };
  optPending?: boolean;
  onClose: () => void;
  onOptToggle: () => void;
  onAddDevice: () => void;
  onFullSettings: () => void;
  onLogout: () => void;
};

export function SettingsDrawer({
  open,
  optedIn,
  storage,
  optPending = false,
  onClose,
  onOptToggle,
  onAddDevice,
  onFullSettings,
  onLogout,
}: Props) {
  const t = useT();
  const { intlLocale } = useI18n();

  if (!open) return null;

  const pct = storage.cap ? Math.round((storage.total_size / storage.cap) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/30" aria-label={t("common.close")} onClick={onClose} />
      <aside className="relative z-10 flex h-full w-full max-w-none flex-col bg-white shadow-xl md:w-[360px]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold">{t("settings.title")}</h2>
          <button type="button" className="text-xl" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-auto p-4">
          <LanguagePicker className="w-full [&_select]:w-full" />
          <Button className="w-full" onClick={onFullSettings}>
            {t("settings.allSettings")}
          </Button>
          <div className="rounded-lg border border-border p-4 text-sm">
            <p className="font-medium">{t("settings.receivingMailShort")}</p>
            <p className="mt-1 text-muted-foreground">
              {t("settings.optedInLabel")}{" "}
              <strong>{optedIn ? t("common.yes") : t("common.no")}</strong>
            </p>
            <Button variant="outline" className="mt-3 w-full" disabled={optPending} onClick={onOptToggle}>
              {optPending ? t("common.working") : optedIn ? t("settings.optOutNode") : t("settings.optInNode")}
            </Button>
          </div>
          <div className="rounded-lg border border-border p-4 text-sm">
            <p className="font-medium">{t("settings.devices")}</p>
            <Button variant="outline" className="mt-3 w-full" onClick={onAddDevice}>
              {t("settings.addDeviceQr")}
            </Button>
          </div>
          <div className="rounded-lg border border-border p-4 text-sm">
            <p className="font-medium">{t("mail.storage")}</p>
            <p className="mt-1 text-muted-foreground">
              {t("mail.bytesUsed", {
                used: storage.total_size.toLocaleString(intlLocale),
                cap: storage.cap.toLocaleString(intlLocale),
                pct,
              })}
            </p>
          </div>
          <Button variant="ghost" className="w-full" onClick={onLogout}>
            {t("settings.signOut")}
          </Button>
        </div>
      </aside>
    </div>
  );
}
