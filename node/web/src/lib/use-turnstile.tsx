import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Meta } from "@/lib/api";

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      size?: "normal" | "compact" | "invisible";
      callback: (token: string) => void;
      "expired-callback"?: () => void;
    },
  ) => string;
  execute?: (widgetId: string) => void;
  reset?: (widgetId: string) => void;
};

function turnstileApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

export function useTurnstile(meta: Meta) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string>("");
  const needsTurnstile = !meta.fakeCheckout && !meta.disableTurnstile && Boolean(meta.turnstileSiteKey);

  useEffect(() => {
    if (!needsTurnstile) return;
    let cancelled = false;
    const mount = () => {
      const api = turnstileApi();
      if (!api || !containerRef.current || widgetIdRef.current) return false;
      widgetIdRef.current = api.render(containerRef.current, {
        sitekey: meta.turnstileSiteKey,
        size: "invisible",
        callback: (token: string) => {
          tokenRef.current = token;
        },
        "expired-callback": () => {
          tokenRef.current = "";
        },
      });
      return true;
    };
    if (mount()) return;
    const interval = window.setInterval(() => {
      if (cancelled) return;
      if (mount()) window.clearInterval(interval);
    }, 200);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [meta.turnstileSiteKey, needsTurnstile]);

  const getTurnstile = useCallback(async (): Promise<string> => {
    if (!needsTurnstile) return "ok";
    const api = turnstileApi();
    if (!api || !widgetIdRef.current) throw new Error("Complete the Turnstile check");
    if (!tokenRef.current) {
      api.execute?.(widgetIdRef.current);
      await new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          if (tokenRef.current) {
            resolve();
            return;
          }
          if (Date.now() - start > 15000) {
            reject(new Error("Complete the Turnstile check"));
            return;
          }
          window.setTimeout(tick, 100);
        };
        tick();
      });
    }
    const token = tokenRef.current;
    tokenRef.current = "";
    api.reset?.(widgetIdRef.current);
    return token;
  }, [needsTurnstile]);

  return { getTurnstile, containerRef, needsTurnstile };
}

export function TurnstileMount({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  return <div ref={containerRef} className="hidden" aria-hidden="true" />;
}
