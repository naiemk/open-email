import { describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { localeFromAcceptLanguage, resolveGeo } from "./geo.ts";

function mockReq(headers: Record<string, string | string[]> = {}): IncomingMessage {
  return { headers, socket: { remoteAddress: "8.8.8.8" } } as IncomingMessage;
}

describe("geo", () => {
  it("resolves locale from Accept-Language", () => {
    expect(localeFromAcceptLanguage("fa-IR,en;q=0.9")).toBe("fa");
    expect(localeFromAcceptLanguage("de-DE,en;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("de-DE,nl-NL")).toBeNull();
  });

  it("returns country and locale from CF header", () => {
    expect(resolveGeo(mockReq({ "cf-ipcountry": "JP" }))).toEqual({ country: "JP", locale: "ja" });
  });
});
