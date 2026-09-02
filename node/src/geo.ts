import type { IncomingMessage } from "node:http";
import geoip from "geoip-country";
import { fromCountry, localeFromTag } from "../../shared/geo-locale.ts";

export type GeoResponse = {
  country: string | null;
  locale: string | null;
};

function clientIp(req: IncomingMessage): string | undefined {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  if (first) return first;
  return req.socket.remoteAddress ?? undefined;
}

function headerCountry(req: IncomingMessage): string | null {
  const cf = req.headers["cf-ipcountry"];
  const vercel = req.headers["x-vercel-ip-country"];
  const raw = (Array.isArray(cf) ? cf[0] : cf) ?? (Array.isArray(vercel) ? vercel[0] : vercel);
  if (!raw || raw === "XX" || raw === "T1") return null;
  return String(raw).toUpperCase();
}

export function resolveGeo(req: IncomingMessage): GeoResponse {
  let country = headerCountry(req);
  if (!country) {
    const ip = clientIp(req);
    if (ip) {
      const lookup = geoip.lookup(ip);
      country = lookup?.country ?? null;
    }
  }
  const locale = fromCountry(country);
  return { country, locale };
}

/** Parse Accept-Language for pay page (browser before IP). */
export function localeFromAcceptLanguage(header: string | undefined): string | null {
  if (!header) return null;
  const tags = header
    .split(",")
    .map((part) => part.split(";")[0]!.trim())
    .filter(Boolean);
  for (const tag of tags) {
    const loc = localeFromTag(tag);
    if (loc) return loc;
  }
  return null;
}

export function resolvePayLocale(req: IncomingMessage): string {
  const accept = req.headers["accept-language"];
  const fromAccept = localeFromAcceptLanguage(Array.isArray(accept) ? accept[0] : accept);
  if (fromAccept) return fromAccept;
  const geo = resolveGeo(req);
  return geo.locale ?? "en";
}
