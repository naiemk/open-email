import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  fromBrowser,
  intlTag,
  isLocale,
  localeDir,
  type Locale,
} from "../../../../shared/geo-locale.ts";
import { loadMessages, translate, type MessageKey, type Messages } from "./messages.ts";

type I18nContextValue = {
  locale: Locale;
  messages: Messages;
  ready: boolean;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  setLocale: (locale: Locale, persist?: boolean) => void;
  intlLocale: string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw && isLocale(raw)) return raw;
  } catch {
    /* private mode */
  }
  return null;
}

function applyDocumentLocale(locale: Locale) {
  document.documentElement.lang = intlTag(locale);
  document.documentElement.dir = localeDir(locale);
}

async function resolveInitialLocale(): Promise<Locale> {
  const stored = readStoredLocale();
  if (stored) return stored;

  const browser = fromBrowser(navigator.languages?.length ? navigator.languages : [navigator.language]);
  if (browser) return browser;

  try {
    const res = await fetch("/geo");
    if (res.ok) {
      const body = (await res.json()) as { locale?: string | null };
      if (body.locale && isLocale(body.locale)) return body.locale;
    }
  } catch {
    /* offline / dev proxy miss */
  }
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [messages, setMessages] = useState<Messages | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const initial = await resolveInitialLocale();
      if (!alive) return;
      const msgs = await loadMessages(initial);
      if (!alive) return;
      setLocaleState(initial);
      setMessages(msgs);
      applyDocumentLocale(initial);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setLocale = useCallback(async (next: Locale, persist = true) => {
    const msgs = await loadMessages(next);
    setLocaleState(next);
    setMessages(msgs);
    applyDocumentLocale(next);
    if (persist) {
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const msgs = messages ?? ({} as Messages);
    return {
      locale,
      messages: msgs,
      ready,
      t: (key, vars) => translate(msgs, key, vars),
      setLocale: (l, persist) => void setLocale(l, persist),
      intlLocale: intlTag(locale),
    };
  }, [locale, messages, ready, setLocale]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export function useT() {
  return useI18n().t;
}
