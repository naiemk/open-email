# ENS claim on L1, mailbox on Base

## Status

Accepted

## Context

**Linked ENS** names live on Ethereum L1; the production **registry** is on Base ([#24](https://github.com/naiemk/open-email/issues/24)). A Base contract cannot read L1 ENS ownership without proof machinery ([#29](https://github.com/naiemk/open-email/issues/29)). Issue [#27](https://github.com/naiemk/open-email/issues/27) deferred linked ENS; this ADR reverses that for `.eth` 2LDs only.

## Decision

- **EnsClaim** on L1: `claim` (NFT controller + passkey + **DEK** public) and `vacate` (permissionless when the NFT moved). Messages Base via `L1CrossDomainMessenger`.
- Base **registry** applies `applyEnsBind` / `applyEnsVacate` from the messenger only. `register()` stays **OE id**-only (rejects dots).
- **Generation** epochs the **mailbox**: re-**claim** or a new NFT holder starts a new generation; old **index** rows and **opt-in** rows for prior generations are ignored.
- SMTP **nodes** may read L1 `ensOwner` / `lastOwner` for dotted names so mail stops before the messenger lands.

## Considered options

- L1 storage proof on Base: rejected (binding ENS owner to WebAuthn is still a second step; more gas and complexity).
- Full **registry** clone on L1: rejected (every **opt-in** would be an L1 tx).

## Consequences

- ENS holders need a wallet for **claim** / **vacate**; day-to-day **opt-in** stays passkey + Base **relayer**.
- Selling an ENS NFT does not transfer the old **DEK** or mail; the buyer **claims** a fresh **mailbox**.
