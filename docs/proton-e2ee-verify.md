# Proton ↔ open-email E2EE verification

Run after deploy of OpenPGP/WKD (PR #81) with UI image updated and `/.well-known/openpgpkey/` reaching the node.

## Preconditions

1. Mailbox opted in on testnet; open inbox once (publishes OpenPGP identity).
2. Confirm WKD:
   ```bash
   # replace LOCAL and DOMAIN / HU as needed
   curl -sS "https://testnet.crypted.email/.well-known/openpgpkey/hu/$(…)?l=LOCAL" | head
   ```
   Expect `BEGIN PGP PUBLIC KEY BLOCK`.

## Matrix

| Direction | Steps | Pass |
|-----------|--------|------|
| Proton → OE | Compose in Proton to `user@testnet.crypted.email`; padlock on; send; open in OE with lock icon and readable body | |
| OE → Proton | Compose in OE to `@proton.me`; after send, compose shows E2EE hint; Proton opens decrypted | |
| OE → Gmail | No WKD key; compose shows not-E2EE; still delivers | |

Failures: check gateway proxies `/.well-known`, `UI_AUTO_UPDATE`/image revision, and opt-in before WKD publish.
