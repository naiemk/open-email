# Envelope algorithm for tracer blobs

Ticket: [#8](https://github.com/naiemk/open-email/issues/8).
Question: what algorithm should the tracer use to seal a message blob (headers included) to `DEK_public`, decryptable in a browser **node** UI?

Constraints from the map: **DEK** is a keypair; the **node** encrypts inbound without the private half; WebCrypto on the client. Compare HPKE ([RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html)), NaCl box / X25519+XSalsa20, and WebCrypto-only hybrids. Tracer-scale: one encoding, not PGP.

This note cites primary sources (RFC 9180, RFC 7748, NaCl, libsodium, W3C Web Cryptography). It does not implement product code.

## Terms

From `CONTEXT.md` / `IDEA.md`:

- **DEK**: the user's encryption **keypair**. The private half is wrapped by per-device **KEK**s and never sits on a **node**. The public half is published for envelopes.
- **Envelope**: per-message encryption. A one-time key seals the blob (including headers); that key is wrapped to `DEK_public`.
- **Node**: an email-provider instance (domain, SMTP, its own web app). The user reads mail in that **node**'s UI ([ADR 0001](../adr/0001-node-is-a-provider.md)).
- **DAL**: storage plus **index**. Sealed blobs are what get pinned; the **index** tuple `(name, time, CID)` is not inside the envelope.
- **OTK**: the per-message key inside the envelope. Encrypts one blob, including RFC822 headers.

Design brief: E2EE holds when the sender encrypts to `DEK_public` before any **node** sees plaintext. Encrypt-at-rest holds for Gmail/Outlook SMTP: the opted-in **node** sees plaintext, encrypts to `DEK_public`, writes the blob. The **node** does not need the **DEK** private key to encrypt inbound. The web app unwraps the **DEK** with the device **KEK** and decrypts locally.

## What the algorithm must do

| Constraint | Meaning |
| --- | --- |
| Public-key encrypt | Seal using only `DEK_public`. The **node** never holds `DEK_private`. |
| Arbitrary-size blob | One RFC822 object, headers inside the plaintext, not as **index** fields. |
| Browser **node** UI | Decrypt with Web Cryptography (`SubtleCrypto`) in the **node**'s web app. |
| One encoding | Tracer does not speak OpenPGP. A later PGP publication of `DEK_public` is a second encoding, not this blob format. |
| Authenticated encryption | Tampering of the sealed blob must fail open/decrypt, not yield silent garbage. |

The glossary's "OTK wrapped to `DEK_public`" is the *traditional* hybrid ("encrypt the symmetric key with the public key"). HPKE takes a different approach: "generate the symmetric key and its encapsulation with the public key" ([RFC 9180 §1](https://www.rfc-editor.org/rfc/rfc9180.html#section-1)). Functionally that **OTK** is still a per-message AEAD key known only after decapsulation by `DEK_private`. The tracer should follow HPKE's construction rather than invent a wrap format.

## HPKE (RFC 9180)

[RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html) is Hybrid Public Key Encryption, a CFRG consensus document. It encrypts arbitrary-sized plaintexts to a recipient public key. A ciphersuite is a triple `(KEM, KDF, AEAD)` ([§4](https://www.rfc-editor.org/rfc/rfc9180.html#section-4)).

### Mode that matches the **node**

Four modes ([Table 1](https://www.rfc-editor.org/rfc/rfc9180.html#section-5)):

| Mode | Value | Sender needs |
| --- | --- | --- |
| `mode_base` | `0x00` | Recipient public key only |
| `mode_psk` | `0x01` | Public key + pre-shared key |
| `mode_auth` | `0x02` | Public key + sender KEM private key |
| `mode_auth_psk` | `0x03` | Both |

`SetupBaseS(pkR, info)` calls `Encap(pkR)`: generate an ephemeral KEM keypair, DH with the recipient public key, return `(shared_secret, enc)` ([§5.1.1](https://www.rfc-editor.org/rfc/rfc9180.html#section-5.1.1), [§4.1 `Encap`](https://www.rfc-editor.org/rfc/rfc9180.html#section-4.1)). The sender never uses `skR`. That is the inbound SMTP path: the **node** holds `DEK_public` and seals.

`mode_auth` would bind the ciphertext to a **node** server key, but then `DEK` and that server key must be the same DH group, and DHKEM auth is vulnerable to key-compromise impersonation if `DEK_private` leaks ([§9.1.1](https://www.rfc-editor.org/rfc/rfc9180.html#section-9.1.1)). Writer authentication already belongs on the **index** (opted-in server key), not inside the envelope. Tracer: `mode_base`.

### Single-shot Seal, one blob

Mail is one object per CID. The single-shot API ([§6.1](https://www.rfc-editor.org/rfc/rfc9180.html#section-6.1)):

```
SealBase(pkR, info, aad, pt) → (enc, ct)
OpenBase(enc, skR, info, aad, ct) → pt
```

`info` is mixed into the key schedule (bound to the AEAD key). `aad` is AEAD associated data (authenticated, not encrypted). Headers go in `pt`, because the design brief puts RFC822 headers *inside* the sealed object. Tracer `info` can bind the mailbox **name** so a blob is not reusable under a different **name**; `aad` can stay empty.

RFC 9180 does **not** specify a wire format. The application must define an encoding that includes at least `enc` and `ct` ([§10](https://www.rfc-editor.org/rfc/rfc9180.html#section-10)). For a frozen suite, `Nenc` is fixed, so the **DAL** blob can be `enc || ct`.

### Ciphersuite that WebCrypto can implement

Registered KEMs ([Table 2](https://www.rfc-editor.org/rfc/rfc9180.html#section-7.1)):

| kem_id | KEM | `Nenc` / `Npk` |
| --- | --- | --- |
| `0x0010` | DHKEM(P-256, HKDF-SHA256) | 65 |
| `0x0020` | DHKEM(X25519, HKDF-SHA256) | 32 |

Registered AEADs ([Table 5](https://www.rfc-editor.org/rfc/rfc9180.html#section-7.3)): AES-128-GCM (`0x0001`), AES-256-GCM (`0x0002`), ChaCha20Poly1305 (`0x0003`). KDF: HKDF-SHA256 (`0x0001`) ([Table 3](https://www.rfc-editor.org/rfc/rfc9180.html#section-7.2)).

HPKE is **not** a `SubtleCrypto` algorithm name. The browser implements the *primitives*; the **node** UI composes HPKE's labeled HKDF on top. That composition is specified: `LabeledExtract` / `LabeledExpand` prefix IKM with `"HPKE-v1"` and a `suite_id` ([§4](https://www.rfc-editor.org/rfc/rfc9180.html#section-4)). DHKEM's `ExtractAndExpand` is **not** the same as "ECDH then HKDF then AES" with arbitrary labels. Interop is the RFC 9180 test vectors ([Appendix A](https://www.rfc-editor.org/rfc/rfc9180.html#appendix-A)), including A.1 Base for DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-128-GCM.

Which primitives WebCrypto actually exposes is the next section. ChaCha20Poly1305 is in HPKE and **not** in WebCrypto; do not pick it for a WebCrypto client.

### Security properties that matter here

- Base mode is IND-CCA2-secure given IND-CCA2 KEM and AEAD ([§9.1](https://www.rfc-editor.org/rfc/rfc9180.html#section-9.1), [§9.1.2](https://www.rfc-editor.org/rfc/rfc9180.html#section-9.1.2)).
- No forward secrecy against **DEK** compromise: a leaked `DEK_private` decrypts past envelopes ([§9.7.4](https://www.rfc-editor.org/rfc/rfc9180.html#section-9.7.4)). That is inherent to encrypt-to-long-term-**DEK**. Sender-side ephemeral material is erased after `Encap`, so compromise of the **node** later does not open old blobs it did not see in plaintext.
- Ciphertexts do not hide plaintext length ([§9.7.6](https://www.rfc-editor.org/rfc/rfc9180.html#section-9.7.6)). Mail size is visible; padding is out of tracer scope.
- Single-shot has no ordering/replay machinery beyond one `(enc, ct)` ([§9.7.1](https://www.rfc-editor.org/rfc/rfc9180.html#section-9.7.1)). Replay of a CID is an **index**/DAL concern.

RFC 9180 exists because prior hybrid schemes (ANSI X9.63 ECIES, IEEE 1363a, ISO/IEC 18033-2, SECG SEC 1) are non-interoperable, often lack IND-CCA2 proofs, and lack test vectors ([§1](https://www.rfc-editor.org/rfc/rfc9180.html#section-1)). That is the case against rolling a WebCrypto-only ECIES lookalike.

## NaCl box / X25519 + XSalsa20-Poly1305

NaCl `crypto_box` is `curve25519xsalsa20poly1305` ([NaCl box](https://nacl.cr.yp.to/box.html): "Selected primitive"). It is public-key *authenticated* encryption: `crypto_box(m, n, pk, sk)` uses the **sender's secret key** and the receiver's public key. The receiver opens with the sender's public key. Distinct messages for the same `{sender, receiver}` need distinct nonces.

That API does **not** match "the **node** encrypts inbound without a long-term box secret that the client must know." The **node** could invent a per-message sender keypair and prepend the ephemeral public key; that is no longer stock `crypto_box`, it is sealed-box.

libsodium sealed boxes are that construction ([sealed boxes](https://doc.libsodium.org/public-key_cryptography/sealed_boxes)):

- `crypto_box_seal(c, m, mlen, pk)` — only the recipient public key.
- Format: `ephemeral_pk ‖ box(m, recipient_pk, ephemeral_sk, nonce=blake2b(ephemeral_pk ‖ recipient_pk))`.
- Algorithm: X25519 + XSalsa20-Poly1305.
- The recipient can check integrity, not sender identity. The sender cannot decrypt later (ephemeral secret is erased).

That *role* matches HPKE Base and the inbound **node**. The *primitives* do not match WebCrypto:

- XSalsa20-Poly1305 is not a `SubtleCrypto` algorithm ([Web Cryptography Level 2 algorithm overview](https://www.w3.org/TR/webcrypto-2/#algorithm-overview): AES-GCM exists; ChaCha20/XSalsa20 do not).
- Blake2b is not a WebCrypto digest (SHA-256/384/512 only).
- A browser **node** UI would need a JS/WASM NaCl/libsodium, not `crypto.subtle`.

libsodium's high-level `crypto_kem_*` is a different primitive again: X-Wing (ML-KEM768 + X25519), introduced in libsodium 1.0.22 ([key encapsulation](https://doc.libsodium.org/public-key_cryptography/key_encapsulation)). That is post-quantum hybrid KEM, not the tracer envelope, and not in WebCrypto.

RFC 9180 itself cites NaCl's `box` as sharing DHKEM's key-compromise impersonation behavior ([§9.1.1](https://www.rfc-editor.org/rfc/rfc9180.html#section-9.1.1)). Sealed box vs HPKE Base is a packaging choice; HPKE is the one with suite IDs, `info`/`aad`, and test vectors.

X25519 the *function* is specified in [RFC 7748 §5](https://www.rfc-editor.org/rfc/rfc7748.html#section-5) (32-byte scalar, 32-byte u-coordinate). HPKE DHKEM(X25519) uses that DH; NaCl box uses it too. Sharing a curve is not sharing an envelope format.

## WebCrypto-only hybrids

[Web Cryptography Level 2](https://www.w3.org/TR/webcrypto-2/) exposes primitives via `SubtleCrypto`. It does not register HPKE, ECIES, or `crypto_box`. Conformance does not mandate a fixed algorithm set; it defines bindings *if* implemented ([§4.2](https://www.w3.org/TR/webcrypto-2/#concepts-algorithms)).

### What is in the API

Level 2 algorithm table ([§19](https://www.w3.org/TR/webcrypto-2/#algorithm-overview)):

| Name | Relevant operations |
| --- | --- |
| ECDH (`namedCurve` `"P-256"` / `"P-384"` / `"P-521"`) | `generateKey`, `deriveBits`, `importKey`, `exportKey` |
| X25519 | same |
| HKDF (RFC 5869) | `deriveBits`, `deriveKey` |
| AES-GCM (128/192/256-bit keys) | `encrypt`, `decrypt`, `generateKey`, `wrapKey`, `unwrapKey` |
| RSA-OAEP | `encrypt`, `decrypt`, `wrapKey`, `unwrapKey` |

ECDH over P-256 is specified as [RFC 6090](https://www.rfc-editor.org/rfc/rfc6090) ECDH ([§24](https://www.w3.org/TR/webcrypto-2/#ecdh)). X25519 is the RFC 7748 function ([§26](https://www.w3.org/TR/webcrypto-2/#x25519)). AES-GCM plaintext is capped at `2^39 - 256` bytes ([§29.4.1](https://www.w3.org/TR/webcrypto-2/#aes-gcm-operations)); mail is inside that. HKDF is extract-then-expand per RFC 5869 ([§33](https://www.w3.org/TR/webcrypto-2/#hkdf)).

The [2017 REC](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/) already had ECDH, HKDF, AES-GCM, and RSA-OAEP. It did **not** list X25519. X25519 arrived via [Secure Curves in the Web Cryptography API](https://wicg.github.io/webcrypto-secure-curves/) (WICG) and is now in Level 2.

Vendor shipping (first-party):

- Chrome: X25519 enabled by default at milestone 133 ([Chrome Platform Status](https://chromestatus.com/feature/6291245926973440), API `browsers.chrome.status`: "Enabled by default", `desktop: 133`).
- Firefox: bug [1904836](https://bugzilla.mozilla.org/show_bug.cgi?id=1904836) fixed in Firefox 130 (`status-firefox130: fixed`).
- Safari: WebKit for Safari 18.4 adds X25519 `generateKey` / `importKey` / `exportKey` / `deriveKey` / `deriveBits` ([WebKit blog](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)).

P-256 ECDH has been in the 2017 REC the whole time. Either DH group can drive HPKE on a current **node** UI.

### Hybrid A: RSA-OAEP wrap of an AES-GCM **OTK**

`generateKey({name:"AES-GCM", length:256})`, `wrapKey`/`encrypt` with RSA-OAEP using `DEK_public`, AES-GCM the blob. This is the traditional hybrid RFC 9180 contrasts in §1. It is fully native `SubtleCrypto` (no labeled KDF to implement). Costs: **DEK** becomes an RSA key (large `Npk`, not the X25519/P-256 key one would later publish as OpenPGP ECC); no CFRG suite IDs; no HPKE `info` binding unless ad-hoc.

### Hybrid B: ephemeral ECDH/X25519 + HKDF + AES-GCM

Level 2 even shows this as Example 1: two X25519 keys, `deriveKey` through HKDF-SHA-256, AES-GCM-256 ([example](https://www.w3.org/TR/webcrypto-2/#x25519-operations)). That is an ECIES-shaped construction. It is *not* HPKE: DHKEM mixes `enc` and the serialized recipient public key into `kem_context`, then `LabeledExtract("eae_prk")` / `LabeledExpand("shared_secret")` ([RFC 9180 §4.1](https://www.rfc-editor.org/rfc/rfc9180.html#section-4.1)). A home-grown label string will not match Appendix A vectors and will not interoperate with any other HPKE stack.

To implement HPKE on WebCrypto, the **node** UI must `deriveBits` the raw DH shared secret, then run RFC 9180's labeled HKDF in JS, then `importKey` the AEAD key for `AES-GCM`. Using `deriveKey` straight to AES skips the KEM and is a different algorithm.

## Comparison

| | HPKE Base, RFC 9180 | NaCl `crypto_box` | libsodium `crypto_box_seal` | WebCrypto RSA-OAEP+AES | Ad-hoc ECDH+HKDF+AES |
| --- | --- | --- | --- | --- | --- |
| Encrypt with `DEK_public` only | Yes (`Encap`) | No (needs sender `sk`) | Yes | Yes | Yes (ephemeral DH) |
| **OTK** / AEAD | Internal to HPKE | XSalsa20-Poly1305 | same | AES-GCM | AES-GCM |
| WebCrypto primitives | ECDH or X25519 + HKDF + AES-GCM | No (XSalsa20, padding API) | No (XSalsa20, Blake2b) | Yes, native wrap | Yes, but not HPKE |
| Suite IDs + test vectors | Yes | NaCl primitive only | libsodium format only | No | No |
| `info` / AAD | Yes | Nonce only | Deterministic nonce | OAEP label only | DIY |
| Tracer **DAL** blob | `enc \|\| ct` (`Nenc` fixed) | padded box | 48-byte overhead + ct | wrapped-key \|\| iv \|\| ct | DIY |

## Tracer recommendation

**Use HPKE, one frozen ciphersuite, `mode_base`, single-shot Seal.** Do not use NaCl box, sealed boxes, RSA-OAEP wrap, or an ad-hoc ECIES hybrid for the tracer **envelope**.

Concrete suite:

- KEM: DHKEM(X25519, HKDF-SHA256) (`kem_id` `0x0020`)
- KDF: HKDF-SHA256 (`kdf_id` `0x0001`)
- AEAD: AES-128-GCM (`aead_id` `0x0001`)
- Mode: `mode_base` (`0x00`)

That is RFC 9180 Appendix A.1. **DEK** is an X25519 keypair ([RFC 7748](https://www.rfc-editor.org/rfc/rfc7748.html)). `Nenc` = 32. **DAL** blob = `enc || ct`. Plaintext = the RFC822 bytes including headers. `info` = the mailbox **name** (UTF-8). `aad` = empty.

Why this suite, not P-256 or ChaCha20:

- X25519 `enc` is 32 bytes vs 65 for uncompressed P-256 ([Table 2](https://www.rfc-editor.org/rfc/rfc9180.html#section-7.1)).
- X25519 is in Web Cryptography Level 2 and shipped in Chrome 133, Firefox 130, and Safari 18.4 (citations above). The tracer **node** UI can require a current browser.
- AES-GCM is in WebCrypto; ChaCha20Poly1305 is in HPKE and not in WebCrypto. Prefer AES-128-GCM so the AEAD step is `subtle.encrypt` / `subtle.decrypt` with no extra stream cipher.
- Interop check: Appendix A.1 Base vectors, not a self-drawn HKDF info string.

Implement HPKE as specified: `deriveBits` for DH, labeled HKDF in application code, AES-GCM for `Seal`/`Open`. Do not treat the Level 2 X25519+HKDF example as the envelope. The **node** SMTP path only needs `DEK_public` (`Encap` + `Seal`). The **node** UI unwraps **DEK** with the device **KEK**, then `Open`.

Out of tracer scope (do not encode them into this blob):

- OpenPGP / WKD as a second publication of `DEK_public` (design brief: later, different encoding).
- `mode_auth` to the **node** server key (**index** already authenticates writers).
- Padding for length hiding.
- Post-quantum KEMs (libsodium X-Wing, future HPKE PQ drafts).
)
