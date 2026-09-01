import { describe, expect, it } from "vitest";
import { fromBrowser, fromCountry, localeFromTag } from "./geo-locale.ts";

describe("geo-locale", () => {
  it("maps BCP-47 tags to supported locales", () => {
    expect(localeFromTag("en-US")).toBe("en");
    expect(localeFromTag("zh-CN")).toBe("zh");
    expect(localeFromTag("zh-TW")).toBe("zh");
    expect(localeFromTag("pt-BR")).toBe("pt");
    expect(localeFromTag("fa-IR")).toBe("fa");
    expect(localeFromTag("de-DE")).toBeNull();
  });

  it("picks first supported browser language", () => {
    expect(fromBrowser(["de-DE", "fr-FR", "en-US"])).toBe("fr");
    expect(fromBrowser(["de-DE", "ja-JP"])).toBe("ja");
    expect(fromBrowser(["de-DE", "nl-NL"])).toBeNull();
  });

  it("maps country codes for IP fallback", () => {
    expect(fromCountry("IR")).toBe("fa");
    expect(fromCountry("JP")).toBe("ja");
    expect(fromCountry("BR")).toBe("pt");
    expect(fromCountry("SA")).toBe("ar");
    expect(fromCountry("CN")).toBe("zh");
    expect(fromCountry("US")).toBeNull();
    expect(fromCountry("XX")).toBeNull();
  });
});
