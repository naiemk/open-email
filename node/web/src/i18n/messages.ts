import type { Locale } from "../../../../shared/geo-locale.ts";
import en from "./messages/en.json";

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

const catalogs: Partial<Record<Locale, Messages>> = {
  en: en as Messages,
};

export async function loadMessages(locale: Locale): Promise<Messages> {
  if (catalogs[locale]) return catalogs[locale]!;
  switch (locale) {
    case "zh":
      catalogs.zh = (await import("./messages/zh.json")).default as Messages;
      break;
    case "es":
      catalogs.es = (await import("./messages/es.json")).default as Messages;
      break;
    case "ar":
      catalogs.ar = (await import("./messages/ar.json")).default as Messages;
      break;
    case "pt":
      catalogs.pt = (await import("./messages/pt.json")).default as Messages;
      break;
    case "id":
      catalogs.id = (await import("./messages/id.json")).default as Messages;
      break;
    case "fr":
      catalogs.fr = (await import("./messages/fr.json")).default as Messages;
      break;
    case "ja":
      catalogs.ja = (await import("./messages/ja.json")).default as Messages;
      break;
    case "fa":
      catalogs.fa = (await import("./messages/fa.json")).default as Messages;
      break;
    default:
      return en as Messages;
  }
  return catalogs[locale]!;
}

export function translate(
  messages: Messages,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  let text = messages[key] ?? (en as Messages)[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return text;
}

export { en };
