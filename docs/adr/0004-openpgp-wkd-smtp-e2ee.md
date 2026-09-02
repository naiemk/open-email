# OpenPGP / WKD for SMTP-edge E2EE

## Status

Accepted

## Context

open-email native envelopes (HPKE to `DEK_public`) give E2EE between open-email users. SMTP to the rest of the internet (Gmail, Outlook, Proton) historically sees **plaintext at the opted-in node**, then encrypt-at-rest for the DAL.

Proton and many PGP clients discover keys via **Web Key Directory (WKD)** and encrypt with **OpenPGP**. `IDEA.md` already called for publishing `DEK_public` as OpenPGP; openpgp.js cannot inject raw X25519 DEK bytes into a transferable OpenPGP certificate.

## Decision

1. **Parallel OpenPGP identity** per mailbox email (`name@node-domain`), Curve25519 ECC cert via `openpgp.generateKey`.
2. **Private OpenPGP key** is wrapped with the **DEK private** (AES-GCM via existing `wrapDek`) and stored on the node; only a device that can unwrap the DEK can unwrap OpenPGP. The node never holds plaintext OpenPGP private material in use.
3. **Public OpenPGP key** is stored on the node and served over **WKD direct method** (`/.well-known/openpgpkey/hu/<hash>`).
4. **Inbound:** SMTP may already carry PGP/MIME ciphertext. The node `sealEnvelope`s opaque RFC822 as today. The **client** `openEnvelope`s, detects OpenPGP, decrypts with the unwrapped OpenPGP private key, then parses MIME.
5. **Outbound:** When WKD (or cached key) finds a recipient pubkey, the **client** encrypts before `/send` and posts `preencrypted` RFC822; the node DKIM-signs and delivers without rewriting the body. If no key, plaintext SMTP remains with honest UX (not E2EE).
6. Prefer native OE HPKE when both parties are open-email mailboxes on known domains; OpenPGP is for external SMTP peers.

## Consequences

- Signup / first unlock must ensure an OpenPGP identity exists and is published for WKD.
- Multi-device works because OpenPGP private is wrapped to DEK, not to a single device KEK.
- Proton padlock requires live WKD on the node domain and gateway routing for `/.well-known/openpgpkey/`.
- This is not “the DEK bytes encoded as OpenPGP”; it is a DEK-controlled OpenPGP key for SMTP interoperability.
