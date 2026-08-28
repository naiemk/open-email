# Passkey relayer options for registry writes

Ticket: [naiemk/open-email#5](https://github.com/naiemk/open-email/issues/5). Branch: `research/passkey-relayer`.

**Question.** How can a browser **opt-in** (and other **registry** writes) using WebAuthn/P-256 without a wallet UI, via a **relayer**? What works on a local chain vs a public L2 testnet, and what a tracer (not production) should assume.

Terms follow `CONTEXT.md`: **registry**, **relayer**, **opt-in**, **node**. A **relayer** posts registry transactions from a WebAuthn/P-256 signature so the user never uses a wallet UI. A **node** must not be able to opt a mailbox into itself.

This note is research only. It does not implement product code.

---

## Answer in one page

A passkey does not produce an Ethereum transaction. It produces a WebAuthn assertion: a P-256 (secp256r1) ECDSA signature over `authenticatorData || SHA-256(clientDataJSON)`, with the intended registry call bound into the WebAuthn **challenge**. ([W3C WebAuthn §7.2](https://www.w3.org/TR/webauthn-2/#sctn-verifying-assertion) steps 20–21.)

On-chain, that P-256 signature is cheap to check only if the chain has `P256VERIFY` at `0x100`. That precompile began as [RIP-7212](https://github.com/ethereum/RIPs/blob/master/RIPS/rip-7212.md) (3,450 gas) on L2s, and is now specified for L1 as [EIP-7951](https://eips.ethereum.org/EIPS/eip-7951) (6,900 gas, same 160-byte interface, two security fixes). Base and Arbitrum both ship it. Without the precompile, a Solidity verifier costs ~330k gas ([daimo-eth/p256-verifier](https://github.com/daimo-eth/p256-verifier)).

Two posting paths exist:

| Path | Who pays gas | Who authorizes the **opt-in** | Infra |
| --- | --- | --- | --- |
| **Protocol relayer** (recommended for a tracer) | Relayer EOA | Registry verifies the mailbox’s WebAuthn pubkey over the call | One funded EOA + registry |
| **ERC-4337** | Bundler / **paymaster** | Smart account `validateUserOp` verifies the passkey; account then calls the registry | EntryPoint + bundler RPC + paymaster + factory |

Authorization never lives in the relayer. The relayer is trusted for liveness and gas, not for “this user opted into this **node**.”

---

## 1. What a browser actually signs

WebAuthn authentication is `navigator.credentials.get()`. The authenticator returns `clientDataJSON`, `authenticatorData`, and `signature`. The relying party (here: the registry verifier) MUST:

1. Check `type == "webauthn.get"`.
2. Check `challenge` equals the base64url encoding of the ceremony challenge.
3. Check the User Present flag.
4. Let `hash = SHA-256(clientDataJSON)`.
5. Verify `signature` over `authenticatorData || hash` with the stored credential public key.

Source: [W3C WebAuthn Level 2, §7.2 Verifying an Authentication Assertion](https://www.w3.org/TR/webauthn-2/#sctn-verifying-assertion), steps 10–11, 16, 20–21.

That public key is NIST P-256 / secp256r1 / prime256v1 — the curve used by Apple Secure Enclave, Android Keystore, FIDO2, and passkeys. Ethereum’s native `ecrecover` is secp256k1, a different curve. That is why a dedicated verifier is required. ([RIP-7212 Motivation](https://github.com/ethereum/RIPs/blob/master/RIPS/rip-7212.md); [EIP-7951 Abstract](https://eips.ethereum.org/EIPS/eip-7951).)

OpenZeppelin’s on-chain library implements that ceremony and **omits** origin, RP ID hash, and signature-counter checks as not useful on-chain; it still checks type, challenge, UP/UV, and the P-256 signature. Hash construction is `sha256(authenticatorData || sha256(clientDataJSON))`. ([OpenZeppelin `WebAuthn.sol` v5.6.1](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.6.1/contracts/utils/cryptography/WebAuthn.sol).)

**Binding the registry write.** Put the intended call in the WebAuthn challenge: `chainId`, registry address, **name**, **node** server key, action (`optIn` / `optOut` / other write), and a registry nonce. The on-chain verifier then requires `C.challenge` to match that encoding. A **node** that only holds its server key cannot produce a valid assertion for another mailbox.

WebAuthn PRF (the **KEK** path in `CONTEXT.md`) is a separate ceremony from this signature. It is not needed to authorize a registry write.

---

## 2. On-chain P-256: EIP-7212 → RIP-7212 → EIP-7951

### RIP-7212 (L2 precompile, Final)

[RIP-7212](https://github.com/ethereum/RIPs/blob/master/RIPS/rip-7212.md) adds `P256VERIFY` at `0x0000000000000000000000000000000000000100`.

- Input (160 bytes, big-endian): `hash || r || s || qx || qy`.
- Output: 32-byte `1` on success; empty on failure.
- Gas: **3,450**.
- Verification, not recovery (no `v`). Matches NIST FIPS 186-5 and existing hardware.
- No malleability check (`s` may be `> n/2`). Wrappers SHOULD add one.

The original draft lived as EIP-7212 and moved to the RIP track for rollups. The RIP is the L2-era spec.

### EIP-7951 (L1 precompile, Final; supersedes RIP-7212)

[EIP-7951](https://eips.ethereum.org/EIPS/eip-7951) keeps the same address, 160-byte input, and return values. Differences:

- Gas: **6,900**.
- Reject recovered point `R'` at infinity.
- Compare `r' ≡ r (mod n)` instead of `r' == r`.
- MUST NOT revert; invalid input returns empty bytes and still burns 6,900 gas.

Bytecode written against RIP-7212 still works. Gas accounting does not.

Fusaka activated EIP-7951 on Ethereum mainnet at epoch 411392 (2025-12-03 21:49:11 UTC), after Hoodi, Holesky, and Sepolia. ([Ethereum Foundation Fusaka announcement](https://blog.ethereum.org/2025/11/06/fusaka-mainnet-announcement).)

### Solidity fallback (any EVM)

[daimo-eth/p256-verifier](https://github.com/daimo-eth/p256-verifier) matches the EIP-7212/RIP-7212 call interface. Cost is about **330k gas**. CREATE2 address: `0xc2b78104907F722DABAc4C69f826a522B2754De4`. Audited (Veridise, 2023).

[OpenZeppelin `P256.sol` v5.6.1](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.6.1/contracts/utils/cryptography/P256.sol) `verify()` tries `0x100` first, then the Solidity path if the precompile is absent. It also rejects `s > n/2`. `verifyNative()` reverts with `MissingPrecompile(0x100)` if `0x100` is empty.

---

## 3. Relayer architectures

### A. Protocol relayer (EOA posts; registry verifies WebAuthn)

Flow:

1. Browser builds the challenge for the registry write.
2. User asserts with the passkey (Face ID / platform authenticator). No wallet extension.
3. Browser POSTs `{call, WebAuthnAuth}` to the protocol **relayer**.
4. Relayer EOA sends a normal Ethereum tx: `registry.optIn(name, nodeKey, auth, …)`.
5. Registry looks up the mailbox’s stored P-256 pubkey and runs `WebAuthn.verify(challenge, auth, qx, qy)`.
6. On success, the **opt-in** is recorded. `msg.sender` is the relayer; authorization is the passkey.

This matches the glossary: the relayer posts the tx; it is not a custodian and not a server-signed opt-in. A **node** cannot opt a user into itself unless it holds that user’s passkey.

Gas: one L2 tx. P-256 check is ~6,900 gas with the precompile, plus WebAuthn envelope (base64url challenge check, two SHA-256s). Without the precompile, add ~330k.

Failure mode: the relayer can censor or go down. It cannot forge an **opt-in**.

### B. ERC-4337 smart account + bundler + paymaster

[ERC-4337](https://ercs.ethereum.org/ERCS/erc-4337) avoids a consensus-layer tx type. The user builds a `UserOperation`. A **bundler** packs `UserOperation`s into `EntryPoint.handleOps`. The account’s `validateUserOp` MAY use any signature scheme, including WebAuthn/P-256. A **paymaster** MAY sponsor gas so the sender holds no ETH.

`UserOperation.signature` is opaque to the protocol; the account defines it. The signature MUST depend on `chainId` and the `EntryPoint` address (replay protection). ([ERC-4337, UserOperation structure and IAccount](https://ercs.ethereum.org/ERCS/erc-4337).)

Canonical EntryPoint addresses (CREATE2, same on every chain that used the official deploy):

| Version | Address | Source |
| --- | --- | --- |
| v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | [eth-infinitism v0.7.0](https://github.com/eth-infinitism/account-abstraction/releases/tag/v0.7.0) |
| v0.8 | `0x4337084d9e255ff0702461cf8895ce9e3b5ff108` | [eth-infinitism README](https://github.com/eth-infinitism/account-abstraction) |
| v0.9 | `0x433709009B8330FDa32311DF1C2AFA402eD8D009` | [eth-infinitism v0.9.0](https://github.com/eth-infinitism/account-abstraction/releases/tag/v0.9.0) |

Local chain: deploy EntryPoint yourself (`hardhat deploy` in that repo). Public L2 testnets already have it.

This path still has no wallet UI if the account owner is a passkey. It adds a bundler, a staked paymaster, a factory, and EntryPoint version lock-in. That is production-grade AA, not a tracer.

### C. Coinbase Smart Wallet / Base Account (vendor 4337 account)

[coinbase/smart-wallet](https://github.com/coinbase/smart-wallet) is an ERC-4337 account with passkey (secp256r1) owners and Ethereum-address owners. `UserOperation.signature` is a `SignatureWrapper { ownerIndex, signatureData }`. For a passkey owner, `signatureData` is a `WebAuthnAuth` struct from [base-org/webauthn-sol](https://github.com/base-org/webauthn-sol). Validation uses EntryPoint **v0.6**. Factory (v1.1): `0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842`.

[Base Account SDK](https://docs.base.org/base-account/overview/what-is-base-account) is the product SDK over those passkey-backed smart wallets (“Sign in with Base”).

This is a **wallet product**, not the open-email **registry**. Using it as the mailbox controller would bind identity to Coinbase’s factory and EntryPoint version. It is a useful reference implementation of “passkey → UserOp → chain,” not the protocol **relayer**.

### D. Base native AA (EIP-8130) — not for this tracer

Base documents [native account abstraction](https://docs.base.org/base-chain/network-information/native-account-abstraction) (EIP-8130): protocol-level accounts, P-256 and WebAuthn authenticators, and a **payer** instead of a paymaster. It is **experimental and currently runs only on the vibenet devnet** (chain id `84538453`). It is not on Base Sepolia or Base mainnet. Do not assume it.

---

## 4. Base and Arbitrum (and OP Stack)

### Base

[Base precompiles](https://docs.base.org/base-chain/specs/protocol/execution/evm/precompiles): `P256VERIFY` at `0x100`, introduced in **Fjord** at 3,450 gas, updated in **Azul** to **6,900** to match EIP-7951.

OP Stack Fjord (which Base follows) activated RIP-7212 on Superchain Sepolia at `1716998400` (2024-05-29) and on Superchain mainnet at `1720627201` (2024-07-10). ([OP Fjord hardfork](https://docs.optimism.io/op-stack/protocol/hardforks/fjord).)

[Osaka on L2](https://docs.optimism.io/op-stack/features/osaka-on-l2) confirms the later 3,450 → 6,900 gas bump via EIP-7951.

**Base Sepolia** therefore has native P-256 verification. A tracer targeting Base Sepolia can call `0x100` directly (or via OpenZeppelin `verifyNative`).

### Arbitrum

[ArbOS 32 Bianca](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos32) added RIP-7212 so secp256r1 verification is ~99% cheaper than Solidity, specifically to enable passkey wallets.

[ArbOS 51 Dia](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos51) applies EIP-7951 on top of that: same interface, plus the infinity check and modular comparison. Vote passed 2025-12-18; activation 2026-01-08. Developers should expect Ethereum-Fusaka `P256VERIFY` behavior.

**Arbitrum Sepolia** has had RIP-7212 since Bianca and EIP-7951 semantics since Dia.

---

## 5. Local chain vs public L2 testnet

| Environment | `P256VERIFY` at `0x100` | ERC-4337 EntryPoint | Practical path |
| --- | --- | --- | --- |
| **Anvil / default local EVM** (pre-Osaka spec) | Absent. `staticcall` returns empty; OpenZeppelin `verify()` falls back to Solidity (~330k gas). | Must deploy | Protocol relayer + OZ `P256.verify` (fallback). Or etch Daimo bytecode at `0x100`. |
| **Anvil / Forge with Osaka (or later) EVM** | Present. Foundry added Osaka `P256VERIFY` decoding and execution ([foundry#13094](https://github.com/foundry-rs/foundry/pull/13094), [foundry#12762](https://github.com/foundry-rs/foundry/issues/12762)). Set `evm_version = "osaka"`. | Must deploy | Protocol relayer + `0x100`. |
| **Base Sepolia / OP Sepolia** | Present since Fjord; gas 6,900 after Osaka-on-L2 / Azul | Official EntryPoint already deployed | Protocol relayer **or** 4337; prefer native precompile. |
| **Arbitrum Sepolia** | Present since ArbOS 32; EIP-7951 semantics since ArbOS 51 | Official EntryPoint already deployed | Same as Base Sepolia. |
| **Ethereum Sepolia** | Present since Fusaka (EIP-7951, 6,900 gas) | Official EntryPoint already deployed | Works; L1 gas is a poor default for a mailbox **opt-in**. |

Foundry tests can mint P-256 signatures with `vm.signP256` (used in [coinbase/smart-wallet#41](https://github.com/coinbase/smart-wallet/issues/41)). That is a test double, not a browser.

`vm.etch` of Daimo’s verifier onto `0x100` is a documented fallback when the precompile is missing ([foundry#12762](https://github.com/foundry-rs/foundry/issues/12762)); some versions needed a custom EIP-compliant verifier rather than etching the Daimo contract as-is. Prefer a real Osaka Anvil or the OpenZeppelin Solidity fallback over etching.

---

## 6. What a tracer should assume

A tracer is a throwaway that proves “Face ID → **opt-in** lands on-chain with no wallet UI.” It is not a bundler network.

1. **Use path A (protocol relayer).** One funded EOA submits `registry` calls. Do not stand up EntryPoint, a bundler, a paymaster, or Coinbase Smart Wallet.

2. **Store a P-256 pubkey on the registry as the mailbox controller**, not an Ethereum address. Signup is `credentials.create()` then `register(name, qx, qy)` via the same relayer.

3. **Verify with OpenZeppelin `WebAuthn` + `P256.verify`.** That path hits `0x100` when present and Solidity when not, so the same bytecode works on Anvil and on Base/Arbitrum Sepolia.

4. **Bind the challenge** to `chainId`, registry, **name**, **node** key, action, nonce. That is what stops a **node** from opting the user in, and what stops the relayer from rewriting the call.

5. **Local:** Anvil with Osaka if easy; otherwise accept the Solidity fallback. Do not require RIP-7212 to exist on a vanilla Hardhat chain.

6. **Public L2 testnet (if the tracer leaves localhost):** Base Sepolia or Arbitrum Sepolia. Assume `P256VERIFY` at `0x100` and 6,900 gas. Do not assume Base native AA.

7. **Treat the relayer as honest-but-curious:** it may log requests and it pays gas; it cannot mint an **opt-in**. Gas comes from wherever the tracer funds the EOA (faucet / anvil accounts), not from a **reseller** payment flow.

8. **Keep ERC-4337 as a later production option**, not a tracer dependency. If production later wants a paymaster and a public mempool, wrap the same registry calls in a passkey smart account. The registry verification story stays “passkey owns the name”; only the posting path changes.

---

## Sources

- [W3C WebAuthn Level 2, §7.2](https://www.w3.org/TR/webauthn-2/#sctn-verifying-assertion)
- [RIP-7212](https://github.com/ethereum/RIPs/blob/master/RIPS/rip-7212.md)
- [EIP-7951](https://eips.ethereum.org/EIPS/eip-7951)
- [ERC-4337](https://ercs.ethereum.org/ERCS/erc-4337)
- [Fusaka mainnet announcement](https://blog.ethereum.org/2025/11/06/fusaka-mainnet-announcement)
- [Base precompiles](https://docs.base.org/base-chain/specs/protocol/execution/evm/precompiles)
- [Base native AA (EIP-8130, vibenet only)](https://docs.base.org/base-chain/network-information/native-account-abstraction)
- [Base Account SDK](https://docs.base.org/base-account/overview/what-is-base-account)
- [Arbitrum ArbOS 32 Bianca (RIP-7212)](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos32)
- [Arbitrum ArbOS 51 Dia (EIP-7951)](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos51)
- [OP Stack Fjord](https://docs.optimism.io/op-stack/protocol/hardforks/fjord)
- [OP Stack Osaka on L2](https://docs.optimism.io/op-stack/features/osaka-on-l2)
- [coinbase/smart-wallet](https://github.com/coinbase/smart-wallet)
- [OpenZeppelin WebAuthn.sol v5.6.1](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.6.1/contracts/utils/cryptography/WebAuthn.sol)
- [OpenZeppelin P256.sol v5.6.1](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.6.1/contracts/utils/cryptography/P256.sol)
- [daimo-eth/p256-verifier](https://github.com/daimo-eth/p256-verifier)
- [eth-infinitism/account-abstraction](https://github.com/eth-infinitism/account-abstraction)
