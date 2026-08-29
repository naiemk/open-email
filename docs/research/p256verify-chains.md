# Where a public registry can use native P256VERIFY cheaply

Ticket: [#21](https://github.com/naiemk/open-email/issues/21).
Branch: `research/p256verify-chains`.

**Question.** Which public networks expose native P-256 verify at `0x100` (RIP-7212 / EIP-7951), what does a WebAuthn `register` + **opt-in** cost there, and which of those are cheap and funded enough for a protocol **relayer**? Compare at least Ethereum Sepolia, a mainnet L2 that claims RIP-7212, and Ethereum mainnet. Facts for a later chain decision, not the decision itself.

Terms follow `CONTEXT.md`: **registry**, **relayer**, **name**, **OE id**, **opt-in**. A **relayer** posts registry transactions from a WebAuthn/P-256 signature so the user never uses a wallet UI.

This note is research only. It does not implement product code and does not pick a production chain.

Prior survey (tracer-era, do not copy blindly): `research/passkey-relayer:docs/research/passkey-relayer.md`. Implementation context, not a source: `relayer/src/l2.ts` in this checkout targets **Base Sepolia** and probes `p256verify` at `0x100`.

---

## Answer in one page

`P256VERIFY` is a precompile at `0x0000000000000000000000000000000000000100`. On L2s it began as [RIP-7212](https://github.com/ethereum/RIPs/blob/master/RIPS/rip-7212.md) (3,450 gas). Ethereum L1 shipped the same 160-byte interface as [EIP-7951](https://eips.ethereum.org/EIPS/eip-7951) (6,900 gas, two security fixes) in the Osaka execution-layer fork, activated as the Fusaka network upgrade. L2s that claimed RIP-7212 have since aligned gas to 6,900.

Live `eth_call` of a known-valid Wycheproof vector to `0x100` returned `0x…01` and `eth_estimateGas` ≈ **30,054** (21,000 intrinsic + 6,900 precompile + calldata) on **Ethereum mainnet, Ethereum Sepolia, Base, Base Sepolia, OP Mainnet, and Arbitrum Sepolia** on 2026-08-29. Arbitrum One returned 30,390 (same precompile plus Arbitrum’s L1-data component). Empty code at `0x100` plus that gas envelope is native precompile, not a Solidity verifier.

This repo’s **registry** (`registry/src/OpenEmailRegistry.sol`) already matches the intended call shape: `register(name, qx, qy, dekPublic, wrappedDek, auth)` then `optIn(name, nodeKey, auth)`, each running OpenZeppelin `WebAuthn.verify`. Local Foundry Osaka (`evm_version = "osaka"`) measured **228,288 gas** for `register` and **91,549 gas** for `optIn` (call execution only). Two **relayer** EOA txs are roughly **0.36–0.43M gas** once 21,000 intrinsic and WebAuthn calldata are added.

At the 2026-08-29 snapshot, a protocol EOA **relayer** paying ETH:

| Network | Native `0x100`? | Approx. USD per `register`+`optIn` | Relayer funding |
| --- | --- | --- | --- |
| Ethereum mainnet | Yes (Fusaka / Osaka, 6,900) | ~$0.05 at 0.06 gwei; ~$1 at 1 gwei; ~$10 at 10 gwei | Real ETH |
| Ethereum Sepolia | Yes (same spec) | Testnet ETH only (1.13 gwei observed) | Faucet |
| Base / OP Mainnet | Yes (Fjord RIP-7212, Azul/Karst 6,900) | ~$0.005–$0.01 at this snapshot (L2 execution + tiny L1 data fee) | Real ETH, cheap |
| Arbitrum One | Yes (ArbOS 32 RIP-7212, ArbOS 51 EIP-7951) | ~$0.02 at the 0.02 gwei floor | Real ETH, cheap |
| Base Sepolia / Arbitrum Sepolia | Yes | Testnet ETH | Faucet |

Without the precompile, Solidity P-256 is ~330k gas for the verify *alone* ([daimo-eth/p256-verifier](https://github.com/daimo-eth/p256-verifier)). Native `0x100` is what makes a public **registry** + **relayer** plausible. This snapshot’s L1 base fee is unusually low (~0.06 gwei); L2s stay cheap even when L1 is 1–10 gwei because execution is sub-cent and blob/data fees were ~10⁻⁹ ETH for a ~500-byte payload.

---

## 1. What the spec actually says

### RIP-7212 (L2, Final)

[RIP-7212](https://github.com/ethereum/RIPs/blob/master/RIPS/rip-7212.md) adds `P256VERIFY` at `PRECOMPILED_ADDRESS` `0x100` (`0x0000000000000000000000000000000000000100`) as of `FORK_TIMESTAMP` on the integrating EVM chain.

- Input: 160 bytes, big-endian `hash ‖ r ‖ s ‖ qx ‖ qy`.
- Output: 32-byte `1` on success; empty on failure.
- Gas: **3,450**.
- Verification, not recovery (no `v`). Matches NIST FIPS 186-5. No malleability check (`s` may be `> n/2`). Wrappers SHOULD add one.
- Required checks: `r,s ∈ (0, n)`; `(qx, qy)` on-curve and in `[0, p)`; reject infinity (many impls use `(0,0)`).
- Comparison: `r' == r` (not modular).

[EIP-7587](https://eips.ethereum.org/EIPS/eip-7587) reserved `0x100`–`0x1ff` for RIP precompiles, which is why L2s and later L1 share `0x100`.

### EIP-7951 / Osaka `P256VERIFY` (L1, Final)

[EIP-7951](https://eips.ethereum.org/EIPS/eip-7951) keeps the same address, 160-byte input, and return values. It **supersedes RIP-7212** with the same interface and two security fixes:

- Gas: **6,900**.
- Reject recovered point `R'` at infinity.
- Compare `r' ≡ r (mod n)` instead of `r' == r`.
- MUST NOT revert; invalid input returns empty bytes and still burns 6,900 gas.

Bytecode written against RIP-7212 still works. Gas accounting does not (3,450 vs 6,900).

The Ethereum execution spec for Osaka charges `GasCosts.PRECOMPILE_P256VERIFY = 6900` and implements the EIP-7951 checks ([`p256verify.py`](https://github.com/ethereum/execution-specs/blob/master/src/ethereum/forks/osaka/vm/precompiled_contracts/p256verify.py), [`gas.py`](https://github.com/ethereum/execution-specs/blob/master/src/ethereum/forks/osaka/vm/gas.py)). Execution-spec tests for Osaka treat 3,450 gas as **insufficient** ([`test_p256verify.py`](https://github.com/ethereum/execution-specs/blob/master/tests/osaka/eip7951_p256verify_precompiles/test_p256verify.py)).

### Which fork, on which layer

- **Osaka** is the execution-layer name; **Fulu** is the consensus-layer name; **Fusaka** is the combined network upgrade ([EIP-8133](https://eips.ethereum.org/EIPS/eip-8133)).
- [EIP-7607](https://eips.ethereum.org/EIPS/eip-7607) (Hardfork Meta — Fusaka) lists EIP-7951 among the included core EIPs and gives activation:

| Network | Epoch | Timestamp | UTC |
| --- | --- | --- | --- |
| Sepolia | 272640 | 1760427360 | 2025-10-14 07:36:00 |
| Mainnet | 411392 | 1764798551 | 2025-12-03 21:49:11 |

Same numbers: [Ethereum Foundation Fusaka mainnet announcement](https://blog.ethereum.org/2025/11/06/fusaka-mainnet-announcement) (slot 13,164,544; “previously activated on Hoodi, Holesky, and Sepolia”) and [Fusaka testnet announcement](https://blog.ethereum.org/2025/09/26/fusaka-testnet-announcement).

Applicability: any chain that has activated Osaka/Fusaka (L1) or that implemented RIP-7212 and later EIP-7951 gas/semantics (L2s below). It is **not** chain-specific in the EIP; it is a hardfork feature.

---

## 2. Which public networks ship it natively (2026)

Probe (2026-08-29, no keys, no spends): `eth_getCode(0x100)` empty, `eth_call` of the Wycheproof vector used by OpenZeppelin `P256.sol` (`sha256("123400")` with `r=5,s=1`, from [C2SP/wycheproof](https://github.com/C2SP/wycheproof) via [OpenZeppelin P256.sol v5.6.1](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.6.1/contracts/utils/cryptography/P256.sol)) returns 32-byte `1`, `eth_estimateGas` ~30k.

### Ethereum Sepolia

- Spec: Fusaka/Osaka includes EIP-7951 ([EIP-7607](https://eips.ethereum.org/EIPS/eip-7607); [EF testnet announcement](https://blog.ethereum.org/2025/09/26/fusaka-testnet-announcement)).
- Live: `https://sepolia.gateway.tenderly.co` — call `0x…01`, estimateGas **30,054**, `eth_gasPrice` **1.131 gwei**, base fee **1.130 gwei**, block 11,592,919.

### Ethereum mainnet

- Spec: Fusaka activated epoch 411392, 2025-12-03 21:49:11 UTC ([EIP-7607](https://eips.ethereum.org/EIPS/eip-7607); [EF announcement](https://blog.ethereum.org/2025/11/06/fusaka-mainnet-announcement)).
- Live: `https://ethereum.publicnode.com` — call `0x…01`, estimateGas **30,054**, `eth_gasPrice` **0.0606 gwei**, base fee **0.0605 gwei**, block 25,862,026.

### Base (OP Stack L2 that claimed RIP-7212)

- Introduced in **Fjord** at RIP-7212’s 3,450 gas. Base Fjord activation: mainnet `1720627201` (2024-07-10 16:00:01 UTC), Sepolia `1716998400` (2024-05-29 16:00:00 UTC) ([Base Fjord overview](https://docs.base.org/base-chain/specs/upgrades/fjord/overview); same timestamps as [OP Fjord](https://docs.optimism.io/op-stack/protocol/hardforks/fjord)).
- OP Stack spec: `P256VERIFY` at `0x100`, introduced Fjord, specified as RIP-7212 ([specs.optimism.io precompiles](https://specs.optimism.io/protocol/precompiles.html)).
- **Azul** raised gas to **6,900** to match EIP-7951. Sepolia live 2026-04-20; mainnet live 2026-05-28 18:00 UTC (`1779991200`) ([Base Azul overview](https://docs.base.org/base-chain/specs/upgrades/azul/overview); [Azul node-upgrade](https://docs.base.org/base-chain/specs/upgrades/azul/node-upgrade); [Base precompiles](https://docs.base.org/base-chain/specs/protocol/execution/evm/precompiles)).
- Note: the Azul exec-engine page writes “EIP-7951 … gas cost of 3,450” then “increases to 6,900 to match the L1 gas cost specified in EIP-7951” ([Azul exec-engine](https://docs.base.org/base-chain/specs/upgrades/azul/exec-engine)). The EIP itself specifies 6,900 ([EIP-7951](https://eips.ethereum.org/EIPS/eip-7951)). Live estimateGas **30,054** matches 6,900, not 3,450.
- Live Base: `https://mainnet.base.org` — call `0x…01`, estimateGas **30,054**, gasPrice **0.006 gwei**, base fee **0.005 gwei**, block 50,615,333.
- Live Base Sepolia: `https://sepolia.base.org` — same precompile envelope, gasPrice **0.006 gwei**, base fee **0.005 gwei**.

### OP Mainnet (same OP Stack claim)

- Fjord added RIP-7212 ([OP Fjord](https://docs.optimism.io/op-stack/protocol/hardforks/fjord); [specs.optimism.io precompiles](https://specs.optimism.io/protocol/precompiles.html)).
- **Karst / Upgrade 19** (“Osaka on L2”) raises `P256VERIFY` from 3,450 to 6,900 ([Osaka on L2](https://docs.optimism.io/op-stack/features/osaka-on-l2); [Karst](https://docs.optimism.io/op-stack/protocol/hardforks/karst)). Superchain default: Sepolia `1781712001` (2026-06-17 16:00:01 UTC), mainnet `1783526401` (2026-07-08 16:00:01 UTC). Status: Active.
- Live: `https://mainnet.optimism.io` — call `0x…01`, estimateGas **30,054**, gasPrice **0.00100 gwei**, base fee ~1.3×10⁻⁶ gwei, block 156,210,620.

### Arbitrum One / Sepolia

- **ArbOS 32 Bianca** added RIP-7212 (“~99% cheaper than Solidity”, passkey wallets) ([ArbOS 32](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos32); AIP: [Support RIP-7212](https://forum.arbitrum.foundation/t/aip-support-rip-7212-for-account-abstraction-wallets-arbos-30/23298)).
- **ArbOS 51 Dia** applies EIP-7951 on top: same interface, infinity check, modular comparison. Governance vote 2025-12-18; activation **2026-01-08**. “Developers should expect the same behavior as the EIP being proposed on Ethereum after Fusaka” ([ArbOS 51](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos51)). Ethereum Fusaka is cited there as epoch 411392 / 2025-12-03.
- Live Arbitrum One: `https://arb1.arbitrum.io/rpc` — call `0x…01`, estimateGas **30,390**, gasPrice **0.020 gwei**, `ArbGasInfo.getMinimumGasPrice()` **0.02 gwei** (ArbOS 51 raised the default minimum L2 base fee from 0.01 to 0.02 gwei — [ArbOS 51](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos51)).
- Live Arbitrum Sepolia: `https://sepolia-rollup.arbitrum.io/rpc` — call `0x…01`, estimateGas **30,054**, gasPrice **0.024 gwei**.

### What 30,054 means

`21,000` intrinsic + `6,900` `P256VERIFY` + calldata for 160 input bytes ≈ 30k. If the chain still charged RIP-7212’s 3,450, the same `eth_estimateGas` would sit near 26–27k. Every probed post-Osaka/Azul/Karst/Dia network sat at ~30,054 (Arbitrum One 30,390 includes extra L1-data accounting). That is native EIP-7951 pricing, not the Solidity fallback (~330k, [daimo-eth/p256-verifier](https://github.com/daimo-eth/p256-verifier)).

---

## 3. Cost of WebAuthn `register` + **opt-in**

### Call shape (this repo)

`OpenEmailRegistry`:

- `register(name, qx, qy, dekPublic, wrappedDek, WebAuthn.WebAuthnAuth)` — stores P-256 controller + DEK material for a new **OE id** (`name` must be dotless).
- `optIn(name, nodeKey, WebAuthn.WebAuthnAuth)` — records **opt-in** of a registered **node** key; bumps nonce.
- Each verifies OpenZeppelin `WebAuthn.verify(challenge, auth, qx, qy)` ([WebAuthn.sol v5.6.1](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.6.1/contracts/utils/cryptography/WebAuthn.sol)): type `webauthn.get`, challenge match, UP/UV flags, then `P256.verify` → `staticcall` `0x100`.
- Challenge binds `chainId`, registry address, action, **name** hash, and (for register) DEK fields / (for **opt-in**) `nodeKey` + nonce. The **relayer** is `msg.sender`; authorization is the passkey.

OpenZeppelin `P256.verify` hits `0x100` once on a valid signature; a second Wycheproof probe runs only when the first call fails ([P256.sol](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.6.1/contracts/utils/cryptography/P256.sol)). It also rejects `s > n/2`.

A browser assertion is larger than the test helper (`registry/test/PasskeySigner.sol` omits `origin` / `crossOrigin`). Production `clientDataJSON` adds those fields → more calldata and a slightly larger SHA-256.

### Foundry Osaka (native `0x100`, this registry)

`foundry.toml` sets `evm_version = "osaka"`. Gas report (call execution, **not** 21,000 intrinsic, **not** tx calldata):

| Function | Gas |
| --- | --- |
| `register` | 228,288 |
| `optIn` | 91,549 |
| `register` + `optIn` (two calls) | 319,837 |

`P256VERIFY` itself is 6,900 of that. The rest is WebAuthn envelope (two SHA-256s, base64url challenge check) plus **registry** storage: `register` writes a new `NameRecord` (several `SSTORE`s); **opt-in** writes the opt-in timestamp and increments nonce.

Two **relayer** EOA transactions add 21,000 intrinsic each plus calldata (WebAuthn `authenticatorData` + `clientDataJSON`). A reasonable full-tx band is **~0.36–0.43M gas** for `register` then `optIn`. Storage, not the precompile, dominates.

Without native `0x100`, add ~330k per verify ([daimo-eth/p256-verifier](https://github.com/daimo-eth/p256-verifier)) — `register` would be ~0.55M+ execution gas.

### USD at the 2026-08-29 snapshot

ETH/USD **$2,447.25** ([CoinGecko](https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd), secondary). Gas token on all networks below is ETH.

Use **430,000 gas** as a conservative two-tx envelope (execution + intrinsic + WebAuthn calldata). L2s also pay an L1 data fee.

**L2 data fee (on-chain oracle, not a blog):** `GasPriceOracle.getL1Fee` at `0x420000000000000000000000000000000000000F` for a 462-byte JSON-like + signature payload:

| Chain | `getL1Fee` | ETH | USD |
| --- | --- | --- | --- |
| Base | 971,695,335 wei | 9.7×10⁻¹⁰ | ~$0.000002 |
| OP Mainnet | 1,302,155,939 wei | 1.3×10⁻⁹ | ~$0.000003 |
| Base Sepolia | 9,540,368,484 wei | 9.5×10⁻⁹ | n/a (testnet) |

Oracle L1 base fee / blob base fee at the same moment: Base 0.057 gwei / 0.0034 gwei; OP 0.062 gwei / 0.0033 gwei (`l1BaseFee()`, `blobBaseFee()` on that predeploy). Blob market was quiet; L1 data is not the story at this snapshot.

| Network | Price used | 430k gas (L2 exec or L1 all-in) | + L1 data | **USD / signup** |
| --- | --- | --- | --- | --- |
| Ethereum mainnet | 0.0606 gwei (`eth_gasPrice`) | 2.6×10⁻⁵ ETH | — | **~$0.06** |
| Ethereum mainnet | 1 gwei (sensitivity) | 4.3×10⁻⁴ ETH | — | **~$1.05** |
| Ethereum mainnet | 10 gwei (sensitivity) | 4.3×10⁻³ ETH | — | **~$10.50** |
| Ethereum Sepolia | 1.13 gwei | 4.9×10⁻⁴ Sepolia ETH | — | faucet, not USD |
| Base | 0.006 gwei | 2.6×10⁻⁶ ETH | ~10⁻⁹ ETH | **~$0.006** |
| OP Mainnet | ~0.001 gwei | ~4×10⁻⁷ ETH | ~10⁻⁹ ETH | **~$0.001** |
| Arbitrum One | 0.02 gwei floor | 8.6×10⁻⁶ ETH | included in Arb gas model | **~$0.02** |

L1 at 0.06 gwei is cheap by historical standards. The sensitivity columns are the ones to use if L1 base fee returns to 1–10 gwei. L2 execution stays sub-cent in that range; L1 data fees would rise with blob/calldata congestion but start from ~10⁻⁹ ETH here.

---

## 4. Relayer economics

A protocol **relayer** is a funded EOA that posts `register` / **opt-in** (and later **opt-out**). It is trusted for liveness and gas, not for forging an **opt-in**.

**Testnets (Sepolia, Base Sepolia, Arbitrum Sepolia).** Native `0x100` is present. Gas token is valueless faucet ETH. Solvency is a faucet problem, not a USD treasury. Ethereum Sepolia gas (~1.1 gwei) is higher than Base Sepolia (~0.006 gwei); a Sepolia **relayer** burns more *testnet* ETH per signup but still nothing priced in USD.

**Mainnet L1.** Native `0x100` works. At this snapshot (~$0.06/signup) a **relayer** is cheap. At 1 gwei (~$1/signup) or 10 gwei (~$10.50/signup) it is not a good default for a mailbox **opt-in** path. No faucet: the EOA must be funded with real ETH.

**Mainnet L2s that ship native `0x100` (Base, OP, Arbitrum One).** Same precompile, same registry bytecode, ETH gas token, orders of magnitude cheaper than L1 at any plausible L1 base fee. Arbitrum’s 0.02 gwei floor is an explicit chain parameter ([ArbOS 51](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos51)); Base/OP L2 base fees were 0.005 gwei / ~10⁻⁶ gwei.

Signups per day a protocol EOA **relayer** can pay (430k gas, ETH at $2,447):

| Daily budget | Base (~$0.006) | Arbitrum One (~$0.02) | L1 @ 0.06 gwei (~$0.06) | L1 @ 1 gwei (~$1.05) | L1 @ 10 gwei (~$10.50) |
| --- | --- | --- | --- | --- | --- |
| $1 | ~160 | ~50 | ~16 | ~1 | 0 |
| $10 | ~1,600 | ~500 | ~160 | ~9 | ~1 |
| $100 | ~16,000 | ~5,000 | ~1,600 | ~95 | ~9 |

Caveats, not a pick:

- These are snapshot prices (2026-08-29 public RPC `eth_gasPrice` / `baseFeePerGas` / L2 oracles). L1 and blob fees move.
- Two txs per signup; a later **opt-out** is another **opt-in**-sized tx.
- Browser `clientDataJSON` is larger than the Foundry helper.
- OpenZeppelin `verify()` falls back to Solidity (~330k) if `0x100` is missing; do not deploy that path to a public **relayer** budget.
- This note does not choose Ethereum vs Base vs OP vs Arbitrum.

---

## Sources

- [RIP-7212](https://github.com/ethereum/RIPs/blob/master/RIPS/rip-7212.md)
- [EIP-7951](https://eips.ethereum.org/EIPS/eip-7951)
- [EIP-7607 Hardfork Meta — Fusaka](https://eips.ethereum.org/EIPS/eip-7607)
- [EIP-7587 RIP precompile range](https://eips.ethereum.org/EIPS/eip-7587)
- [EIP-8133 network upgrade naming](https://eips.ethereum.org/EIPS/eip-8133)
- [Ethereum execution spec Osaka `p256verify.py`](https://github.com/ethereum/execution-specs/blob/master/src/ethereum/forks/osaka/vm/precompiled_contracts/p256verify.py)
- [Ethereum execution spec Osaka `gas.py`](https://github.com/ethereum/execution-specs/blob/master/src/ethereum/forks/osaka/vm/gas.py)
- [Fusaka mainnet announcement](https://blog.ethereum.org/2025/11/06/fusaka-mainnet-announcement)
- [Fusaka testnet announcement](https://blog.ethereum.org/2025/09/26/fusaka-testnet-announcement)
- [OP Stack precompiles](https://specs.optimism.io/protocol/precompiles.html)
- [OP Fjord](https://docs.optimism.io/op-stack/protocol/hardforks/fjord)
- [OP Osaka on L2](https://docs.optimism.io/op-stack/features/osaka-on-l2)
- [OP Karst](https://docs.optimism.io/op-stack/protocol/hardforks/karst)
- [Base Fjord overview](https://docs.base.org/base-chain/specs/upgrades/fjord/overview)
- [Base precompiles](https://docs.base.org/base-chain/specs/protocol/execution/evm/precompiles)
- [Base Azul overview](https://docs.base.org/base-chain/specs/upgrades/azul/overview)
- [Base Azul exec-engine](https://docs.base.org/base-chain/specs/upgrades/azul/exec-engine)
- [ArbOS 32 Bianca](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos32)
- [ArbOS 51 Dia](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos51)
- [AIP: Support RIP-7212](https://forum.arbitrum.foundation/t/aip-support-rip-7212-for-account-abstraction-wallets-arbos-30/23298)
- [OpenZeppelin WebAuthn.sol v5.6.1](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.6.1/contracts/utils/cryptography/WebAuthn.sol)
- [OpenZeppelin P256.sol v5.6.1](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.6.1/contracts/utils/cryptography/P256.sol)
- [daimo-eth/p256-verifier](https://github.com/daimo-eth/p256-verifier)
- Live RPC (2026-08-29): `ethereum.publicnode.com`, `sepolia.gateway.tenderly.co`, `mainnet.base.org`, `sepolia.base.org`, `mainnet.optimism.io`, `arb1.arbitrum.io/rpc`, `sepolia-rollup.arbitrum.io/rpc`
- ETH/USD (secondary): [CoinGecko](https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd)
