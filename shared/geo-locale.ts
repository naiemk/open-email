/** Supported UI locales (internet top 8 + Farsi). */
export const LOCALES = ["en", "zh", "es", "ar", "pt", "id", "fr", "ja", "fa"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "oe-locale";

export type LocaleInfo = {
  id: Locale;
  /** Native language name for the picker. */
  label: string;
  rtl: boolean;
};

export const LOCALE_INFO: Record<Locale, LocaleInfo> = {
  en: { id: "en", label: "English", rtl: false },
  zh: { id: "zh", label: "中文", rtl: false },
  es: { id: "es", label: "Español", rtl: false },
  ar: { id: "ar", label: "العربية", rtl: true },
  pt: { id: "pt", label: "Português", rtl: false },
  id: { id: "id", label: "Bahasa Indonesia", rtl: false },
  fr: { id: "fr", label: "Français", rtl: false },
  ja: { id: "ja", label: "日本語", rtl: false },
  fa: { id: "fa", label: "فارسی", rtl: true },
};

const AR_COUNTRIES = new Set([
  "SA", "EG", "AE", "IQ", "MA", "DZ", "LY", "TN", "JO", "LB", "KW", "QA", "BH", "OM", "YE", "SY", "SD", "PS",
]);
const ES_COUNTRIES = new Set([
  "ES", "MX", "AR", "CO", "CL", "PE", "VE", "EC", "GT", "CU", "BO", "DO", "HN", "PY", "SV", "NI", "CR", "PA", "UY",
]);
const FR_COUNTRIES = new Set(["FR", "BE", "CH", "LU", "MC", "SN", "CI", "CM", "MG", "CD", "HT"]);

/** Map BCP-47 tag prefix to supported locale. */
export function localeFromTag(tag: string): Locale | null {
  const lower = tag.trim().toLowerCase();
  if (!lower) return null;
  const base = lower.split("-")[0]!;
  if (base === "zh") return "zh";
  if (base === "pt") return "pt";
  if (base === "fa") return "fa";
  if (LOCALES.includes(base as Locale)) return base as Locale;
  return null;
}

/** First supported locale from browser language list. */
export function fromBrowser(languages: readonly string[]): Locale | null {
  for (const tag of languages) {
    const loc = localeFromTag(tag);
    if (loc) return loc;
  }
  return null;
}

/** Map ISO 3166-1 alpha-2 country code to locale (IP fallback). */
export function fromCountry(country: string | null | undefined): Locale | null {
  if (!country) return null;
  const cc = country.trim().toUpperCase();
  if (!cc || cc === "XX" || cc === "T1") return null;
  if (cc === "IR" || cc === "AF") return "fa";
  if (AR_COUNTRIES.has(cc)) return "ar";
  if (cc === "CN" || cc === "TW" || cc === "HK" || cc === "MO" || cc === "SG") return "zh";
  if (cc === "BR") return "pt";
  if (cc === "ID") return "id";
  if (cc === "JP") return "ja";
  if (ES_COUNTRIES.has(cc)) return "es";
  if (FR_COUNTRIES.has(cc)) return "fr";
  return null;
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function localeDir(locale: Locale): "ltr" | "rtl" {
  return LOCALE_INFO[locale].rtl ? "rtl" : "ltr";
}

/** BCP-47 tag for Intl formatters. */
export function intlTag(locale: Locale): string {
  switch (locale) {
    case "zh":
      return "zh-CN";
    case "pt":
      return "pt-BR";
    case "fa":
      return "fa-IR";
    case "ar":
      return "ar";
    default:
      return locale;
  }
}
