# How a trustless-commerce testnet invoice works

Ticket: [#42](https://github.com/naiemk/open-email/issues/42).
Branch: `research/trustless-commerce-invoice`.

**Question.** What does [testnet.trustless-commerce.com](https://testnet.trustless-commerce.com) actually expose for a USDC invoice (create, pay, paid webhook/callback, amounts, which chain/token)? What must our **node** UI call so **register** + 200MB storage can wait on payment?

Terms follow `CONTEXT.md`: **node**, **registry**, **relayer**, **OE id**, **name**, **reseller**. A **node** is one email-provider instance (SMTP + that node's HTTP/UI). The **registry** is this project's on-chain contract (not Trustless Commerce). A **relayer** posts WebAuthn-signed txs so the user never uses a wallet UI for **register** / **opt-in**. Payment here is a separate USDC invoice; it does not itself call the **registry**.

This note is research only. It does not implement product code and does not pick the USDC **price** for registration + 200MB.

---

## Answer in one page

[testnet.trustless-commerce.com](https://testnet.trustless-commerce.com) is the Trustless Commerce hosted stack: SPA UI + public HTTP API. There is no GitHub repo `naiemk/trustless-commerce` (404). The product source is [`naiemk/onchain-invoice`](https://github.com/naiemk/onchain-invoice). The HTML advertises an agent skill at that repo. Docs live at [naiemk.github.io/onchain-invoice](https://naiemk.github.io/onchain-invoice/). Neither `onchain-invoice` nor `@trustless-commerce/platform-sdk` is on the npm registry (checked 2026-08-30). `naiemk`'s published npm package is `vibed-infra` only.

`IDEA.md` already points at this shape: on-chain audience pays via a “trustless-commerce-style pay link”; activating a **name** requires registration + storage paid.

For a USDC invoice on this testnet host, the working rail is **Ethereum Sepolia** (`chainId` `"11155111"`), token **`USDC`**, Circle's Sepolia USDC at [`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`](https://developers.circle.com/stablecoins/usdc-contract-addresses) (6 decimals). The buyer pays that token to a deterministic `invoiceAddress` (CREATE2 forwarder). A sweeper later sends `amount - fee` to the merchant `to` address. Default deploy fee is `FEE_BPS=50` (0.5%).

Create and status are **unauthenticated** (IP rate limits). The **node** UI (or its server) should:

1. `POST https://testnet.trustless-commerce.com/api/invoices` with `price`, merchant `to`, `chains: ["11155111"]`, `tokens: ["USDC"]`, `chainId: "11155111"`, `token: "USDC"`, `selectedTo`, `clientInvoiceId`, `paymentMode: "crypto"`, and `callback` (HTTPS URL on the **node**).
2. Redirect (or iframe) the payer to `https://testnet.trustless-commerce.com` + `payLink` (`/pay?id=<invoice.id>`).
3. Poll `GET /api/invoices/:id` until `status` is `paid`, `paid_partial`, or `swept` (docs: every 5–15s while on-site). Treat `callback` as best-effort: one POST `{ "type": "invoice.updated", "invoice": {…} }` on first paid-like transition, **no signature, no retries**.
4. Only then have the **relayer** submit **register** (and whatever storage write this product uses). Trustless Commerce does not call the open-email **registry**. `to` is an operator payout EOA/contract on Sepolia, not the **registry** address.

`price` is a USD decimal string the **merchant** sets (`"10.00"` → 10 USDC face). Trustless Commerce has no 200MB storage tariff. That amount is an open-email product choice.

Live probes (2026-08-30) against the testnet host: `GET /api/health` → `{ "ok": true, "service": "trustless-commerce" }`; Sepolia USDC `POST /api/invoices` → **201** `awaiting_payment` + `payLink`; same `Idempotency-Key` → **200** `created: false`; Base `8453` create → **503** (sweeper not configured); Nile create → **503** (`TRON_INVOICE_MASTER_SECRET`); `GET /api/docs` → **404** `{ "error": "Not found" }`. No OpenAPI on the host.

---

## 1. What the host is (and is not)

The testnet origin serves a Vite SPA (`/assets/index-*.js`) plus nginx in front of the commerce API. Home HTML description: “Accept crypto payments with deterministic on-chain invoices. No account, no KYC — create a pay link in about a minute.” Canonical link in that HTML is `https://trustlesscommerce.app/` (that hostname did not resolve from this environment). `robots.txt` allows `/` and points the sitemap at `https://trustlesscommerce.app/sitemap.xml`, which lists `/`, `/integrations`, `/create`, `/merchant`.

SPA routes (`/create`, `/pay`, `/integrations`, `/merchant`) return the same HTML shell. `/pay` is the hosted checkout; docs allow cross-origin iframes of `/pay` only (`header=none`). Other UI routes send `Content-Security-Policy: frame-ancestors 'none'`.

The HTML alternate skill:

```
https://raw.githubusercontent.com/naiemk/onchain-invoice/main/.cursor/skills/trustless-commerce-invoice/SKILL.md
```

`GET /api/health` (fetched): `{ "ok": true, "service": "trustless-commerce", "time": "…" }`. `GET /api/ready` (fetched): `{ "ok": true, "db": true }`. CORS on API responses: `access-control-allow-origin: *` with methods `GET,POST,PATCH,DELETE,OPTIONS` and headers including `content-type`, `idempotency-key`, `x-api-key`, `x-merchant-*`. A **node** UI on another origin can call create/poll from the browser. The **callback** is the API server POSTing *out* to a URL the **node** must expose.

There is no public OpenAPI on the host: `GET /api/docs` and `GET /api/openapi.json` return **404** `{ "error": "Not found" }`. The contract is the GitHub docs + skill + live routes.

`gh api repos/naiemk/trustless-commerce` → **404**. `GET https://registry.npmjs.org/onchain-invoice` and `…/@trustless-commerce%2Fplatform-sdk` → `{ "error": "Not found" }`. In-repo `package.json` name is `onchain-invoice`; `platforms/sdk/node/package.json` name is `@trustless-commerce/platform-sdk` (install from the monorepo, not npm).

---

## 2. Create (USDC invoice)

Canonical call ([platform integration](https://naiemk.github.io/onchain-invoice/platform-integration/), [HTTP API](https://raw.githubusercontent.com/naiemk/onchain-invoice/main/docs/api.md), [skill](https://raw.githubusercontent.com/naiemk/onchain-invoice/main/.cursor/skills/trustless-commerce-invoice/SKILL.md)):

```http
POST /api/invoices
Content-Type: application/json
Idempotency-Key: <stable node-side id>
```

Auth: **none**. Rate limit bucket `create`, default ~1/s/IP (`RATE_LIMIT_CREATE_PER_SECOND`). **429** `{ "error": "Rate limit exceeded" }` with `Retry-After`, `RateLimit-Remaining`, `RateLimit-Reset`. Live empty POST (no `price`) returned **500** `{ "error": "Missing pay-link parameter: price" }` — validation exists; do not treat that status as part of the stable contract.

Stable request fields (platform docs):

| Field | Required | Notes |
| --- | --- | --- |
| `price` | yes (crypto) | USD decimal string, e.g. `"49.00"` — settlement face value of USDC/USDT |
| `to` | yes | Merchant payout address(es). EVM `0x…` |
| `chains` | yes | Allowed chain ids. Testnet USDC: `["11155111"]` |
| `tokens` | yes | e.g. `["USDC"]` |
| `chainId` | yes* | Selected chain (`*` defaults to first of `chains`) |
| `token` | yes* | Selected token |
| `selectedTo` | yes* | Payout for the selected chain |
| `clientInvoiceId` | recommended | **node** order / signup id; returned on invoice and callback |
| `callback` | recommended | HTTPS URL for payment webhook |
| `title` / `description` | optional | Shown on `/pay` |
| `allowPartial` | optional | Default `false` |
| `paymentMode` | optional | `"crypto"` (default), `"crypto_or_fiat"`, `"fiat"` |

Do **not** send `invoiceSeed` — the API assigns it; client-supplied seeds are **400**. Deprecated: `POST /api/sessions` + `POST /api/invoices/activate`.

`invoice.id` is `keccak256(abi.encode(bytes32 invoiceSeed, string[] toAddresses))`. `clientInvoiceId`, price, title, `chains`, `tokens` are **not** in the hash.

Response: **201** when new, **200** when `Idempotency-Key` replay (`created: false`). Without a key, a duplicate deterministic id is **409**. Body:

- `invoice` — record (`id`, `invoiceAddress`, `status: "awaiting_payment"`, `priceUsd`, `chainId`, `token`, `callbackUrl`, `amountPaid`, …)
- `payLink` — `/pay?id=<invoice.id>` (resume this invoice)
- `checkoutLink` — pre-invoice `/pay?price=…&to=…&chains=…&tokens=…` template

Live Sepolia USDC create (testnet host, 2026-08-30) returned **201** with `chainId: "11155111"`, `token: "USDC"`, `status: "awaiting_payment"`, `amountPaid: "0"`, `paymentMode: "crypto"`, relative `payLink` `/pay?id=0x…`. Replay with the same `Idempotency-Key` returned **200** `created: false` and the same `invoice.id` / `invoiceAddress`.

Prefix relative links with `https://testnet.trustless-commerce.com`.

---

## 3. Pay

Two buyer paths ([create docs](https://raw.githubusercontent.com/naiemk/onchain-invoice/main/docs/create.md)):

1. **API-first (what the node UI should use):** create, then send the user to `{baseUrl}{payLink}`.
2. **Shareable `/pay?price=&to=&chains=&tokens=`:** Continue on the hosted page creates the invoice (seed stays server-side).

The payer sends USDC to `invoice.invoiceAddress` on Sepolia. The address is a yet-undeployed ERC-1167 forwarder; the commerce sweeper deploys it with CREATE2 salt `keccak256(abi.encodePacked(to, invoiceId))` and sweeps. A wrong `to` hashes to a different empty address — the sweeper cannot redirect funds ([README](https://github.com/naiemk/onchain-invoice/blob/main/README.md), [`CommerceInvoiceSweeper.sol`](https://github.com/naiemk/onchain-invoice/blob/main/contracts/commerce/CommerceInvoiceSweeper.sol)).

Hosted chrome: `header=full` (default top-level), `minimal`, `none` (iframe). Not sent to `POST /api/invoices`.

`GET /api/public/faucet` returned `{ "enabled": true }` (secret-gated on `/pay`; not a substitute for Circle's Sepolia USDC faucet).

Card/bank (`paymentMode` `fiat` / `crypto_or_fiat`) uses Onramper. `GET /api/public/onramp` on testnet returned `enabled: true`, `sandbox: true`, `demo: false`, including pair `{ "chainId": "11155111", "token": "USDC" }`. Operator env says demo/onramp **does not fund** Sepolia/Nile. Open-email's ticket is a **USDC** invoice: use `paymentMode: "crypto"`.

---

## 4. Paid: poll and callback

### Poll (required for reliability)

```http
GET /api/invoices/:id
```

Unauthenticated. Live fetch returns the invoice fields **plus** `events[]` (flat object, not wrapped in `{ "invoice": … }`). Create is wrapped; poll is not. Status URL in the skill is this GET.

Lifecycle ([platform integration](https://naiemk.github.io/onchain-invoice/platform-integration/)):

| Status | Meaning | **node** action |
| --- | --- | --- |
| `awaiting_payment` | Active, nothing paid | Keep signup pending |
| `paid` | Full payment seen on-chain | Proceed to **relayer** **register** + storage |
| `paid_partial` | Only if `allowPartial: true` | Product policy; default is off |
| `swept` | Funds swept to merchant `to` | Already paid; optional “settled” |

Mark complete on `paid`, `paid_partial` (if allowed), or `swept`. Poll every 5–15s while the payer is on-site.

`GET /api/invoices` **without** `to` returned **401** `{ "error": "Missing merchant signature headers" }`. `GET /api/invoices?to=0x…` on live testnet returned **200** `{ "invoices": [ … ] }` **without** merchant headers (docs: wallet headers optional for that list). Prefer GET-by-id.

### Callback (best-effort, not enough alone)

Create field `callback` is stored as `callbackUrl`. When the sweeper first tracks a paid-like status, the API POSTs:

```http
POST {callback}
Content-Type: application/json

{ "type": "invoice.updated", "invoice": { /* full invoice record */ } }
```

Source [`commerce/server/routes.ts`](https://github.com/naiemk/onchain-invoice/blob/main/commerce/server/routes.ts): fire on first transition into `paid` / `paid_partial` / `swept` (not every re-track); `fetch` with JSON body; log HTTP status as an invoice event; on network error, log `kind: "error"`. **No HMAC, no shared secret, no retries.** Docs: respond 2xx quickly; match `clientInvoiceId` or `invoice.id`; be idempotent; still poll.

This is not Onramper's `POST /api/public/onramp-webhook` (that verifies `X-Onramper-Webhook-Signature` for card ramps).

The **node** should expose `https://crypted.email/…` (or whatever this **node**'s public HTTPS is), pass it as `callback`, and still poll.

---

## 5. Amounts, chain, token (what testnet actually runs)

### Chain / token matrix on this host

| Rail | Product `chainId` | Token | Live `POST /api/invoices` (2026-08-30) |
| --- | --- | --- | --- |
| Ethereum Sepolia USDC | `11155111` | `USDC` | **201** `awaiting_payment` |
| Ethereum Sepolia USDT | `11155111` | `USDT` | **201** (API accepted; sweeper example lists **USDC only** on 11155111 — do not use for this product) |
| Base mainnet | `8453` | `USDC` | **503** `EVM chain 8453 is not configured — set EVM_8453_SWEEPER_ADDRESS…` |
| TRON Nile | `nile` | `USDT` | **503** `TRON_INVOICE_MASTER_SECRET is required to create Tron invoices` |

Docs index: “Ethereum Sepolia (USDC) and TRON Nile (USDT) are live in product.” ROADMAP: Sepolia is the end-to-end reference; Nile/Solana implemented in code; **Base is UI labels**; mainnet contracts not deployed. UI `networksForDeployment("testnet")` keeps Sepolia + Nile (Solana Devnet `enabled: false`). Live testnet API matched **Sepolia only** for a successful create.

Operator env [`deploy/.env.testnet.example`](https://github.com/naiemk/onchain-invoice/blob/main/deploy/.env.testnet.example): `BASE_URL=https://testnet.trustless-commerce.com`, Sepolia sweeper `0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9`, forwarder implementation `0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9`. Etherscan Sepolia shows that sweeper receiving `Sweep` txs.

USDC contract: Circle [USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses) — Ethereum Sepolia `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`. Same address in [`commerce/config/sweeper.example.yaml`](https://github.com/naiemk/onchain-invoice/blob/main/commerce/config/sweeper.example.yaml) (11155111 / USDC / 6 decimals) and live `GET /api/public/wallet-config` `feeTokenAddress` / `stableTokens`.

UI `tokenDecimals("USDC", "11155111")` is 6. `price: "1.00"` is one USDC (1_000_000 base units).

### Fees and `price`

`price` is chosen by the caller. Trustless Commerce does not price open-email **register** or 200MB. The **node** (or protocol) picks a USD string and puts it in `price`.

On sweep, [`CommerceInvoiceSweeper`](https://github.com/naiemk/onchain-invoice/blob/main/contracts/commerce/CommerceInvoiceSweeper.sol): `fee = max(amount * feeBps / 10000, minFeeByToken[token])`; merchant receives `amount - fee`. Deploy script default `FEE_BPS ?? "50"` (0.5%). README commerce section states the same default. An `eth_call` of `feeBps()` on the testnet sweeper from this environment reverted (wrong selector or node); do not treat a live bps value as confirmed here. Buyer still sends the full `price`; the platform fee comes out of the sweep, not as a second invoice.

`amountPaid` / `amountSwept` / `feeCollected` on the invoice record are strings the sweeper tracks (live unpaid invoice: `"0"`).

---

## 6. What the **node** UI must call (wait on payment, then **register**)

Trustless Commerce is a **pay-link + payout** service. It does not know **OE id**, 200MB, or the **registry**. `IDEA.md`: on-chain path is a trustless-commerce-style pay link for storage + activation; fiat path is a **reseller** **node**. This ticket is the on-chain invoice.

Glue:

```
node UI                         testnet.trustless-commerce.com              Sepolia
  |  POST /api/invoices  ----->  create, invoiceAddress                      |
  |  redirect /pay?id=   ----->  hosted checkout  ---- payer sends USDC --->  invoiceAddress
  |  GET /api/invoices/:id  <--  awaiting_payment | paid | swept             |
  |  POST callback (optional) <-  invoice.updated                            |
  |  relayer register+storage --------------------------------------------->  open-email registry
```

Concrete calls (base `https://testnet.trustless-commerce.com`):

1. **Create** — `POST /api/invoices` with Sepolia USDC fields above. `to` / `selectedTo` = operator USDC payout on Sepolia (must hold/receive Circle USDC). `clientInvoiceId` = signup attempt id. `callback` = `https://<this-node>/…/invoices/webhook`. Header `Idempotency-Key` = same id. Store `invoice.id`.
2. **Pay UX** — navigate or iframe `https://testnet.trustless-commerce.com` + `payLink`. User needs a Sepolia wallet and test USDC; the default path still has no wallet UI for **register**, but **this** payment does.
3. **Wait** — poll `GET /api/invoices/{id}` until `paid` or `swept` (and/or handle `invoice.updated`). Do not **register** on `awaiting_payment`.
4. **Then** — **relayer** posts the **registry** txs (name + storage accounting). Payment does not invoke the **registry**.

Browser vs server: CORS `*` allows the **node** UI to create and poll from the client. `callback` still needs a public HTTPS POST endpoint on the **node**. Rate limit: ~1 create/s/IP.

Out of this ticket: the USD number for **register** + 200MB; whether one invoice covers both or two invoices; which operator address is `to`; whether to wait for `paid` vs `swept`.

---

## 7. Facts for a later grill (not a pick)

- Testnet USDC invoices that actually create today are **Sepolia + Circle USDC**. Nile/Base creates **503** on the live host.
- Create + GET-by-id need no API key. Callback has no signature. Combine poll + callback.
- `price` is merchant-set. 200MB is not a Trustless Commerce SKU.
- Paying the invoice is not **register**. The **relayer** still submits **registry** txs after `paid`/`swept`.
- No npm package to depend on; copy [`@trustless-commerce/platform-sdk`](https://github.com/naiemk/onchain-invoice/tree/main/platforms/sdk/node) from the repo or call HTTP.
- Hosted `/pay` is the buyer UI; the **node** should not rebuild wallet checkout unless it must.

This note does not choose the registration USDC amount or the operator `to` address.

---

## Sources

- Live host: [https://testnet.trustless-commerce.com](https://testnet.trustless-commerce.com) (`GET /`, `/api/health`, `/api/ready`, `/api/public/wallet-config`, `/api/public/onramp`, `/api/public/faucet`, `POST /api/invoices`, `GET /api/invoices/:id`, `GET /api/invoices?to=`, `GET /api/docs`)
- [onchain-invoice README](https://github.com/naiemk/onchain-invoice/blob/main/README.md)
- [Trustless Commerce docs (index)](https://naiemk.github.io/onchain-invoice/)
- [Platform integration contract](https://naiemk.github.io/onchain-invoice/platform-integration/)
- [Invoice types](https://naiemk.github.io/onchain-invoice/invoice-types/)
- [Agents](https://naiemk.github.io/onchain-invoice/agents/)
- [docs/api.md](https://github.com/naiemk/onchain-invoice/blob/main/docs/api.md)
- [docs/create.md](https://github.com/naiemk/onchain-invoice/blob/main/docs/create.md)
- [docs/ops.md](https://github.com/naiemk/onchain-invoice/blob/main/docs/ops.md)
- [docs/security.md](https://github.com/naiemk/onchain-invoice/blob/main/docs/security.md)
- [ROADMAP.md](https://github.com/naiemk/onchain-invoice/blob/main/ROADMAP.md)
- [Skill: trustless-commerce-invoice](https://github.com/naiemk/onchain-invoice/blob/main/.cursor/skills/trustless-commerce-invoice/SKILL.md)
- [commerce/server/routes.ts](https://github.com/naiemk/onchain-invoice/blob/main/commerce/server/routes.ts) (`postCallback`, track → paid-like)
- [commerce/server/config.ts](https://github.com/naiemk/onchain-invoice/blob/main/commerce/server/config.ts)
- [commerce/config/server.example.yaml](https://github.com/naiemk/onchain-invoice/blob/main/commerce/config/server.example.yaml)
- [commerce/config/sweeper.example.yaml](https://github.com/naiemk/onchain-invoice/blob/main/commerce/config/sweeper.example.yaml)
- [deploy/.env.testnet.example](https://github.com/naiemk/onchain-invoice/blob/main/deploy/.env.testnet.example)
- [scripts/deploy-commerce.ts](https://github.com/naiemk/onchain-invoice/blob/main/scripts/deploy-commerce.ts)
- [CommerceInvoiceSweeper.sol](https://github.com/naiemk/onchain-invoice/blob/main/contracts/commerce/CommerceInvoiceSweeper.sol)
- [ui/src/shared/networks.ts](https://github.com/naiemk/onchain-invoice/blob/main/ui/src/shared/networks.ts)
- [platforms/sdk/node](https://github.com/naiemk/onchain-invoice/tree/main/platforms/sdk/node)
- [WooCommerce webhook handler](https://github.com/naiemk/onchain-invoice/blob/main/platforms/woocommerce/trustless-commerce-for-woocommerce/includes/class-trustless-commerce-webhook.php)
- [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [Sepolia sweeper 0x5bcb…46cB9](https://sepolia.etherscan.io/address/0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9)
- This repo: `IDEA.md` (Payment — trustless-commerce-style pay link)
- npm: `https://registry.npmjs.org/onchain-invoice`, `https://registry.npmjs.org/@trustless-commerce%2Fplatform-sdk`, `https://registry.npmjs.org/-/v1/search?text=maintainer:naiemk`
- GitHub: `gh api repos/naiemk/trustless-commerce` (404); [`naiemk/onchain-invoice`](https://github.com/naiemk/onchain-invoice)
