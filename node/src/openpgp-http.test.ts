import { describe, expect, it } from "vitest";
import { generateOpenPgpIdentity, publicKeyFromWkdBytes } from "../../client/src/openpgp-identity.ts";
import { createOpenPgpKeyStore } from "./openpgp-keys.ts";
import { parseWkdHuPath, wkdPublicKeyBytes } from "./openpgp-http.ts";

describe("parseWkdHuPath", () => {
  it("parses direct and advanced WKD hu paths", () => {
    const hu = "abc123";
    expect(parseWkdHuPath(`/.well-known/openpgpkey/hu/${hu}`)).toBe(hu);
    expect(parseWkdHuPath(`/.well-known/openpgpkey/testnet.crypted.email/hu/${hu}`)).toBe(hu);
    expect(parseWkdHuPath("/.well-known/openpgpkey/policy")).toBeNull();
  });
});

describe("wkdPublicKeyBytes", () => {
  it("returns binary OpenPGP key bytes, not ASCII armor", async () => {
    const id = await generateOpenPgpIdentity("alice@testnet.crypted.email");
    const bytes = await wkdPublicKeyBytes(id.publicArmored);
    expect(new TextDecoder().decode(bytes.slice(0, 20))).not.toContain("BEGIN PGP");
    const armored = await publicKeyFromWkdBytes(bytes);
    expect(armored).toContain("BEGIN PGP PUBLIC KEY");
  });
});

describe("WKD hu lookup", () => {
  it("finds record by hu hash of local-part", async () => {
    const id = await generateOpenPgpIdentity("bob@testnet.crypted.email");
    const store = createOpenPgpKeyStore();
    const record = store.set({
      name: "bob.testnet",
      email: "bob@testnet.crypted.email",
      publicArmored: id.publicArmored,
      wrappedPrivateHex: "0x01",
    });
    expect(store.getByHu(record.hu)).toBeDefined();
    const binary = await wkdPublicKeyBytes(record.publicArmored);
    expect(binary.length).toBeGreaterThan(100);
  });
});
