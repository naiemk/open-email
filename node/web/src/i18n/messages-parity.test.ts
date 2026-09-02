import { describe, expect, it } from "vitest";
import en from "./messages/en.json";

const LOCALES = ["zh", "es", "ar", "pt", "id", "fr", "ja", "fa"] as const;
const enKeys = Object.keys(en).sort();

describe("i18n message parity", () => {
  for (const locale of LOCALES) {
    it(`${locale}.json has same keys as en.json`, async () => {
      const mod = await import(`./messages/${locale}.json`);
      const keys = Object.keys(mod.default).sort();
      expect(keys).toEqual(enKeys);
    });
  }
});
