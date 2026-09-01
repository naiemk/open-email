import { LOCALE_INFO, LOCALES, type Locale } from "../../../../shared/geo-locale.ts";
import { useI18n } from "./I18nProvider.tsx";

type Props = {
  className?: string;
};

export function LanguagePicker({ className = "" }: Props) {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className={`inline-flex items-center gap-2 text-sm ${className}`}>
      <span className="sr-only">{t("settings.language")}</span>
      <select
        aria-label={t("settings.language")}
        className="rounded-md border border-border bg-white px-2 py-1.5 text-sm"
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        {LOCALES.map((id) => (
          <option key={id} value={id}>
            {LOCALE_INFO[id].label}
          </option>
        ))}
      </select>
    </label>
  );
}
