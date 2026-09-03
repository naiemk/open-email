import { describe, expect, it } from "vitest";
import { generateDek } from "./dek.ts";
import {
  decryptOpenPgp,
  encryptForOpenPgp,
  extractOpenPgpCiphertext,
  generateOpenPgpIdentity,
  looksLikeOpenPgpMessage,
  unwrapOpenPgpPrivate,
  wkdHuHash,
  wrapOpenPgpPrivate,
  wrapPgpMime,
  zbase32Encode,
} from "./openpgp-identity.ts";

describe("openpgp identity (DEK-wrapped OpenPGP key)", () => {
  it("hashes WKD hu with z-base-32(sha1(local))", () => {
    expect(zbase32Encode(new Uint8Array([0]))).toMatch(/^[ybndrfg8ejkmcpqxot1uwisza345h769]+$/);
    // Known vector: local-part "test" — hash is stable
    const hu = wkdHuHash("Test");
    expect(hu).toBe(wkdHuHash("test"));
    expect(hu.length).toBeGreaterThan(10);
  });

  it("encrypts and decrypts round-trip with generated OpenPGP keys", async () => {
    const id = await generateOpenPgpIdentity("alice@testnet.crypted.email");
    const plain = "From: a\r\nTo: b\r\nSubject: hi\r\n\r\nsecret body";
    const ct = await encryptForOpenPgp(plain, id.publicArmored);
    const out = await decryptOpenPgp(ct, id.privateArmored);
    expect(out.replace(/\r\n/g, "\n")).toBe(plain.replace(/\r\n/g, "\n"));
  });

  it("wraps OpenPGP private with DEK so any DEK holder can unwrap", async () => {
    const dek = generateDek();
    const id = await generateOpenPgpIdentity("bob@example.com");
    const wrapped = wrapOpenPgpPrivate(id.privateArmored, dek.privateKey);
    expect(wrapped).not.toEqual(new TextEncoder().encode(id.privateArmored));
    const recovered = unwrapOpenPgpPrivate(wrapped, dek.privateKey);
    expect(recovered).toBe(id.privateArmored);
    const ct = await encryptForOpenPgp("hello", id.publicArmored);
    expect(await decryptOpenPgp(ct, recovered)).toBe("hello");
  });

  it("builds PGP/MIME and extracts ciphertext for decrypt", async () => {
    const id = await generateOpenPgpIdentity("carol@example.com");
    const inner = "From: x\r\nTo: y\r\nSubject: z\r\n\r\nbody";
    const ct = await encryptForOpenPgp(inner, id.publicArmored);
    const mime = wrapPgpMime(ct, "a@x", "b@y", "z");
    expect(looksLikeOpenPgpMessage(mime)).toBe(true);
    const extracted = await extractOpenPgpCiphertext(mime);
    const out = await decryptOpenPgp(extracted, id.privateArmored);
    expect(out.replace(/\r\n/g, "\n")).toBe(inner.replace(/\r\n/g, "\n"));
  });
});
