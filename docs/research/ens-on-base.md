# Can a Base registry verify linked ENS?

Ticket: [#29](https://github.com/naiemk/open-email/issues/29).
Branch: `research/ens-on-base`.

**Question.** ENS names live on Ethereum L1. The intended production **registry** is Base ([#24](https://github.com/naiemk/open-email/issues/24)). Can a contract on Base verify that a user controls `vitalik.eth` (or a Sepolia/test ENS) without a wallet UI, in a way a **relayer** can post? Facts for [#27](https://github.com/naiemk/open-email/issues/27), not the product pick.

Terms follow `CONTEXT.md`: **registry** (this project's contract, not the ENS registry), **relayer**, **linked ENS**, **name**, **OE id**. **Linked ENS** is an ENS string recorded in the **registry** after the owner proves control; the ENS NFT never moves. A **relayer** posts WebAuthn-signed txs so the user never uses a wallet UI.

This note is research only. It does not implement product code and does not pick whether v1 allows **linked ENS**.

---

## Answer in one page

A Solidity contract on Base cannot `staticcall` the ENS registry. The canonical ENS registry, ETH registrar, and Name Wrapper live on Ethereum L1 (same registry address on Sepolia). Official ENS deployments on Base are the ENSIP-19 **L2 reverse registrar** only — primary-name claims, not `.eth` ownership. ENSv2 stays on L1; Namechain is cancelled.

Base's protocol-native L1 window is `L1Block` at `0x420…0015`: L1 block **number, timestamp, hash, basefee**, not arbitrary L1 storage. There is no predeploy that returns “this address owns `vitalik.eth`”.

ENS CCIP-read (EIP-3668 + ENSIP-10) is the **opposite direction**: an L1 resolver defers *resolution records* (addr, text, …) to an L2 or HTTP gateway. Clients unwrap `OffchainLookup`. That is how `jesse.base.eth`-style subnames work. It does not give a Base contract a view of L1 name ownership.

What a **relayer** *can* post as one ordinary Base tx, with no wallet UI on that tx:

1. **L1 storage proof.** Relayer calls `eth_getProof` on L1 for `ENSRegistry.owner(node)` and, if wrapped, `NameWrapper.ownerOf(node)`. It submits the L1 header + Merkle proofs. The Base contract checks `keccak256(rlp(header)) == L1Block.hash`, then verifies the account/storage proofs against that header's `stateRoot`. That is trustless given OP Stack's L1 origin. It proves “address *A* owns this name at this L1 block”. It does **not** by itself bind *A* (typically a secp256k1 EOA or the Name Wrapper) to the mailbox's WebAuthn/P-256 controller.

2. **EIP-3668 as a transaction.** The contract can revert `OffchainLookup`; a CCIP-aware **relayer** fetches the gateway and calls the callback. EIP-3668 explicitly allows this for `eth_sendTransaction` after an `eth_call`/`eth_estimateGas` preflight. The callback still has to *verify* the bytes (a storage proof against `L1Block.hash`, or a signature). ENS's documented CCIP-read is not this pattern.

3. **L1→L2 message.** An L1 contract reads ENS and `sendMessage`s to Base. Base executes it automatically. That **requires an L1 transaction** (wallet UI unless a separate L1 poster). It is not a Base tx the open-email **relayer** submits.

Testnet analogue: Ethereum Sepolia hosts the full ENS registry (same `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`) plus an ENSv2 beta. Base Sepolia's L1 is Ethereum Sepolia (`L1CrossDomainMessenger` / `OptimismPortal` listed under “Ethereum Testnet (Sepolia)”). Proving a Sepolia `.eth` name from a Base Sepolia **registry** is the same storage-proof (or L1-message) problem, with `L1Block.hash` a Sepolia blockhash. Base Sepolia has no ENS registry for `.eth`; it has the L2 reverse registrar at `0x00000BeEF055f7934784D6d81b6BC86665630dbA`.

---

## 1. How ENS ownership is proven on L1 today

ENS is three parts: registry, resolvers, registrars ([ENSIP-1](https://docs.ens.domains/ens-improvement-proposals/ensip-1-ens)). Resolution is two-step: hash the name (`namehash`) to a `node`, ask the registry for the resolver, then query the resolver ([ENS resolution](https://docs.ens.domains/resolution)). **Ownership is not the resolver.** It is registry / registrar / wrapper state.

### Registry owner (manager)

The registry records `owner`, `resolver`, and `ttl` per node ([ENS registry](https://docs.ens.domains/registry/ens); [ENSRegistry.sol](https://github.com/ensdomains/ens-contracts/blob/master/contracts/registry/ENSRegistry.sol)). Specified in [EIP-137](https://eips.ethereum.org/EIPS/eip-137) / [ENSIP-1](https://docs.ens.domains/ens-improvement-proposals/ensip-1-ens):

```
ENS.owner(bytes32 node) view returns (address)
```

Only that owner (or an `isApprovedForAll` operator) may `setOwner` / `setResolver` / `setSubnodeOwner`. The public resolver authorizes writes by reading this owner and, if it is the Name Wrapper, substituting `NameWrapper.ownerOf` ([ENS contracts: integrating](https://ensdomains-ens-contracts.mintlify.app/guides/integrating-ens)).

### `.eth` 2LD NFT (registrant)

The ETH registrar is split: **BaseRegistrar** owns names (ERC-721 `ownerOf(tokenId)` where `tokenId` is the labelhash); **ETHRegistrarController** prices register/renew ([ETH registrar](https://docs.ens.domains/registry/eth)). Unwrapped `.eth` 2LDs have a separate **Owner** (the NFT on the BaseRegistrar) and **Manager** (registry `owner`) ([Name Wrapper overview](https://docs.ens.domains/wrapper/overview)). Control of the NFT is `BaseRegistrar.ownerOf`; control of records is registry `owner`. They can differ.

### Wrapped names

The Name Wrapper takes the registry owner (and, for `.eth` 2LDs, the ERC-721) and issues an ERC-1155. After wrap there is a single owner/manager ([Name Wrapper overview](https://docs.ens.domains/wrapper/overview)). Check ([wrapper overview / ens-contracts](https://ensdomains-ens-contracts.mintlify.app/contracts/wrapper/overview); [wrapper states](https://ensdomains-ens-contracts.mintlify.app/contracts/wrapper/states)):

- Registry `owner(node)` **is** the Name Wrapper, **and**
- `NameWrapper.ownerOf(uint256(node))` is non-zero.

`INameWrapper.ownerOf(uint256 id)` is the wrapped owner ([INameWrapper.sol](https://github.com/ensdomains/ens-contracts/blob/master/contracts/wrapper/INameWrapper.sol)). Transferring a name into the wrapper via `registry.setOwner` alone is **not** a wrap; there is no ERC-1155 until `wrap` / `wrapETH2LD`.

### What “proves control” means on L1

On L1, control is: call `owner(node)` (and `ownerOf` on wrapper or BaseRegistrar as above) in the same transaction, or be `msg.sender` equal to that address. There is no separate “ownership proof” protocol. Resolver records (`addr`, `text`) are **not** ownership; anyone who is the manager can set them. Reverse / primary names (ENSIP-19) map **address → preferred name**, not name → owner.

A **linked ENS** that “never moves the NFT” is compatible with this: read owner, do not `transferFrom` / `unwrap`.

### Where those contracts live

Resolution “needs to start somewhere, so the entrypoint … is Ethereum Mainnet, alongside the most popular testnets.” “The core ENS protocol lives on Ethereum Mainnet” ([deployments](https://docs.ens.domains/learn/deployments)). Source of truth: [ensdomains/ens-contracts deployments](https://github.com/ensdomains/ens-contracts/tree/staging/deployments) / [wiki](https://github.com/ensdomains/ens-contracts/wiki/ENS-Contract-Deployments).

| Contract | Mainnet | Sepolia |
| --- | --- | --- |
| ENSRegistry | [`0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`](https://etherscan.io/address/0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e) | same address |
| BaseRegistrarImplementation | [`0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85`](https://etherscan.io/address/0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85) | same address |
| NameWrapper | [`0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401`](https://etherscan.io/address/0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401) | [`0x0635513f179D50A207757E05759CbD106d7dFcE8`](https://sepolia.etherscan.io/address/0x0635513f179D50A207757E05759CbD106d7dFcE8) |

The registry address is the same on mainnet and Sepolia ([ENS contracts: integrating](https://ensdomains-ens-contracts.mintlify.app/guides/integrating-ens)).

ENSv2: Sepolia already runs ENSv2 contracts; the ENS apps for Sepolia resolve through that deployment ([deployments](https://docs.ens.domains/learn/deployments)). ENSv2 will be deployed **exclusively on Ethereum L1**; Namechain development has ceased ([ENS blog, nick.eth](https://ens.domains/blog/post/ens-staying-on-ethereum)). L1 ownership does not move to Base under current ENS plans.

---

## 2. What Base (and ENS-on-L2) actually offer

### `L1Block`: L1 *attributes*, not L1 storage

OP Stack / Base predeploy `L1Block` at `0x4200000000000000000000000000000000000015` ([Base predeploys](https://docs.base.org/base-chain/specs/protocol/execution/evm/predeploys); [OP specs](https://specs.optimism.io/protocol/predeploys.html); same address on [Base mainnet and Base Sepolia](https://docs.base.org/base-chain/network-information/base-contracts)).

From [L1Block.sol](https://github.com/ethereum-optimism/optimism/blob/develop/packages/contracts-bedrock/src/L2/L1Block.sol):

> The L1Block predeploy gives users access to information about the last known L1 block. Values … are updated once per epoch (every L1 block) and can only be set by the “depositor” account.

Public fields include `number`, `timestamp`, `basefee`, **`hash`** (latest L1 blockhash), `sequenceNumber`, fee scalars, `blobBaseFee`. Specs say this “allows for L1 state to be accessed in L2” ([Base predeploys](https://docs.base.org/base-chain/specs/protocol/execution/evm/predeploys)). The contract does **not** expose ENS slots. The accessible “L1 state” is those attributes. The Ecotone `BeaconBlockRoot` predeploy (`0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02`) is L1 **beacon** block roots ([EIP-4788](https://eips.ethereum.org/EIPS/eip-4788)), also not ENS storage.

### L1→L2 messages (deposit txs)

`L1CrossDomainMessenger.sendMessage` on Ethereum becomes an L2 execution through `L2CrossDomainMessenger` at `0x420…0007`. L1→L2: user pays L2 gas **on L1**; Base derives a deposit tx automatically — the user does not call `relayMessage` on L2 ([Base messengers](https://docs.base.org/base-chain/specs/protocol/bridging/messengers); [deposits](https://docs.base.org/base-chain/specs/protocol/bridging/deposits); [bridging](https://docs.base.org/base-chain/network-information/bridging-and-withdrawals)). Authorization of the L2 `from` is the L1 deposit event, not an L2 signature. This path **starts with an L1 transaction**.

### ENS on Base: reverse registrar, not the `.eth` registry

[ens-contracts `deployments/base`](https://github.com/ensdomains/ens-contracts/tree/staging/deployments/base) and [`deployments/baseSepolia`](https://github.com/ensdomains/ens-contracts/tree/staging/deployments/baseSepolia) contain **`L2ReverseRegistrar.json` only** — no `ENSRegistry`, `NameWrapper`, or `BaseRegistrar`.

[ENSIP-19](https://docs.ens.domains/ensip/19) deploys per-chain reverse registrars for primary names. Base mainnet: `0x0000000000D8e504002cC26E3Ec46D81971C1664` under `"80002105.reverse"`. Base Sepolia: `0x00000BeEF055f7934784D6d81b6BC86665630dbA` under `"80014a34.reverse"`. These contracts store `address → name` on the L2. L1 wildcard resolvers then CCIP-read them for reverse resolution. That is **not** “who owns `vitalik.eth`”.

### Official ENS CCIP-read / ENSIP-10 (L1 → L2 records)

[Offchain / L2 resolvers](https://docs.ens.domains/resolvers/ccip-read): “ENS name resolution always starts from Ethereum Mainnet”; EIP-3668 lets a **resolver** defer data to an L2 or offchain API. Example: `greg.base.eth` → L1 resolver → Coinbase gateway → address. Flow:

1. Client calls `resolve()` on the L1 resolver.
2. Resolver reverts `OffchainLookup(sender, urls, callData, callbackFunction, extraData)` ([EIP-3668](https://eips.ethereum.org/EIPS/eip-3668)).
3. Client HTTP-fetches the gateway; calls the callback; contract verifies (signature or, for trustless L2, L2 state root on L1).

[ENSIP-10](https://docs.ens.domains/ens-improvement-proposals/ensip-10-wildcard-resolution) adds `resolve(bytes name, bytes data)` (`0x9061b923`) so parent resolvers can answer names with no on-chain resolver — the usual pairing with CCIP-read for L2 subnames.

ENS docs: from the L1 resolver, L2 resolution **is the same revert** as offchain; the difference is the gateway and callback. Trustless L2 resolution on L1 verifies against the **L2 state root on L1** (they point at Unruggable Gateways). That is **L2 data proven on L1**, not L1 ENS ownership proven on Base.

### What this is not

Coinbase `*.base.eth` subnames are an L2/offchain namespace under an L1 parent (`base.eth`), resolved via CCIP-read ([ENS CCIP-read](https://docs.ens.domains/resolvers/ccip-read)). They are not a replica of `.eth` ownership and are not a substitute for proving `vitalik.eth`.

---

## 3. Can a Base contract return “this address owns vitalik.eth” in one relayer tx?

**Direct call: no.** The ENS registry is not deployed on Base. `L1Block` does not read it. CCIP-read as ENS specifies it is an L1-resolver client protocol.

**With calldata the relayer gathers: yes, as a storage proof (or as an EIP-3668 callback that carries one).**

### Path A — L1 storage proof in one Base tx (relayer-posted, no wallet UI)

1. Relayer reads `L1Block.hash` / `L1Block.number` on Base.
2. Relayer fetches that L1 block's header and `eth_getProof` for the ENS registry (and Name Wrapper if needed) ([EIP-1186](https://eips.ethereum.org/EIPS/eip-1186): account + storage Merkle proofs; “combined with a stateRoot (from the blockheader) it enables offline verification”).
3. Relayer submits one Base transaction: header + proofs + the `node`.
4. Contract: `keccak256(rlp_encode(header)) == L1Block.hash` (or a recent hash if the chain exposes a window; Base stores **the latest** L1 hash, so the proof must target that epoch's L1 origin). Extract `stateRoot` from the header. Verify the account proof for `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`, then the storage proof for `records[node].owner` ([ENSRegistry](https://github.com/ensdomains/ens-contracts/blob/master/contracts/registry/ENSRegistry.sol) `mapping(bytes32 => Record) records` at slot 0; `Record` packs `owner`, `resolver`, `ttl`). If that owner is the Name Wrapper, a second proof of `ownerOf(node)` on the wrapper.

No L1 transaction. No wallet UI. The **relayer** is `msg.sender`. The user need not hold ETH on Base.

Caveats (facts, not a pick):

- `L1Block.hash` is the **current** L1 origin, not a ring of historical hashes. A proof must be built against that block (or the contract must accept a header whose hash matches, and treat staleness separately). OP Stack updates it once per L1 epoch ([L1Block.sol](https://github.com/ethereum-optimism/optimism/blob/develop/packages/contracts-bedrock/src/L2/L1Block.sol)).
- MPT verification in Solidity is possible; it is not a Base/ENS precompile. Gas and implementation risk sit on the **registry**.
- Result is “address *A* is registry owner / wrapped owner at L1 block *N*”. Wrapped vs unwrapped must be handled ([wrapper states](https://ensdomains-ens-contracts.mintlify.app/contracts/wrapper/states)).
- *A* is almost never the WebAuthn P-256 key. Binding *A* to the mailbox still needs something *A* can produce: an ECDSA/EIP-1271 signature (wallet UI or a contract wallet), or an L1 text record the proof also reads (setting that record is an L1 tx). That binding is outside ENS's ownership API.

### Path B — EIP-3668 callback (off-chain fetch, on-chain verify)

[EIP-3668 § “Use of CCIP read for transactions”](https://eips.ethereum.org/EIPS/eip-3668): while preflighting with `eth_call` / `eth_estimateGas`, a client that sees `OffchainLookup` may fetch the gateway and **send a transaction** to the callback. “Ideal for applications such as making onchain claims supported by offchain proof data.” Clients SHOULD disable CCIP-read for transactions by default; the **relayer** would enable it.

A Base **registry** could revert `OffchainLookup`, have a gateway return `eth_getProof` bytes, and verify them in the callback against `L1Block.hash`. That is application CCIP-read, not ENS's L1-resolver CCIP-read. The EVM still only accepts the proof in the **callback** call; a naive `linkEns(name)` that reverts `OffchainLookup` **as the submitted tx** just reverts. The relayer must submit the callback.

### Path C — L1 contract attests via messenger (not a Base-only relayer tx)

L1 contract: `require(ens.owner(node) == msg.sender)` (or wrapper `ownerOf`), then `L1CrossDomainMessenger.sendMessage(baseRegistry, abi.encode(node, owner), gas)`. Base executes it as a deposit tx ([messengers](https://docs.base.org/base-chain/specs/protocol/bridging/messengers)). Trust: the L1 messenger pair, not a storage-proof library. Cost: an L1 tx from the ENS-controlling key (wallet UI) **or** from an L1 relayer the owner authorized. The open-email **relayer** on Base does not originate this.

### Path D — Trust a gateway signature

ENS's offchain-resolver example: gateway returns data signed by a trusted key; L1 callback checks the signature ([CCIP-read](https://docs.ens.domains/resolvers/ccip-read)). Same pattern on Base would mean the **registry** trusts that key for “who owns `vitalik.eth`”. That is not L1-state verification.

---

## 4. Testnet analogue: Sepolia ENS vs Base Sepolia

| | Ethereum Sepolia | Base Sepolia |
| --- | --- | --- |
| Chain | L1 testnet; ENS entrypoint ([deployments](https://docs.ens.domains/learn/deployments)) | OP-Stack L2, chain id `84532` ([connect](https://docs.base.org/base-chain/quickstart/connecting-to-base)) |
| L1 of this chain | — | Ethereum Sepolia ([L1 contracts listed under “Ethereum Testnet (Sepolia)”](https://docs.base.org/base-chain/network-information/base-contracts)) |
| ENSRegistry / `.eth` registrar / Name Wrapper | Yes ([wiki sepolia](https://github.com/ensdomains/ens-contracts/wiki/ENS-Contract-Deployments#sepolia)) | **No** ([deployments/baseSepolia](https://github.com/ensdomains/ens-contracts/tree/staging/deployments/baseSepolia) = L2ReverseRegistrar only) |
| ENSv2 | Sepolia runs ENSv2 beta; apps resolve through it ([deployments](https://docs.ens.domains/learn/deployments)) | Not the v2 registry |
| ENSIP-19 reverse | Default reverse on Sepolia L1 | L2 reverse registrar `0x00000BeEF055f7934784D6d81b6BC86665630dbA` ([ENSIP-19](https://docs.ens.domains/ensip/19); [L2ReverseRegistrar.json](https://github.com/ensdomains/ens-contracts/blob/staging/deployments/baseSepolia/L2ReverseRegistrar.json)) |
| `L1Block.hash` | n/a | Sepolia L1 blockhash ([L1Block](https://github.com/ethereum-optimism/optimism/blob/develop/packages/contracts-bedrock/src/L2/L1Block.sol)) |

A **test linked ENS** for a Base Sepolia **registry** is a name on **Ethereum Sepolia** ENS (legacy registry at `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`, or ENSv2 on Sepolia), proved on Base Sepolia the same way mainnet ENS would be proved on Base: storage proof against `L1Block`, or L1→L2 message from Sepolia.

There is no official “Base Sepolia `.eth`” registry to call. `vitalik.eth` on mainnet is invisible to Base Sepolia's `L1Block` (wrong L1). Use a Sepolia `.eth` (or ENSv2 name) for testnet.

Holesky still has a full ENS deployment ([wiki](https://github.com/ensdomains/ens-contracts/wiki/ENS-Contract-Deployments#holesky)); ENS docs mark Holesky as being phased out in favor of Sepolia ([deployments](https://docs.ens.domains/learn/deployments)).

---

## 5. Facts for a later grill (not a pick)

- **Linked ENS** on a Base **registry** cannot be a `staticcall` to ENS. It is extra proof machinery (MPT vs L1 messenger vs trusted signer) or it is omitted.
- Official ENS CCIP-read does not solve “Base reads L1 owner”. It solves “L1 resolver reads L2/offchain *records*”.
- A **relayer** can post a storage-proof tx with no wallet UI. That proves an L1 **address** owns the name. Binding that address to WebAuthn is a second step ENS does not specify.
- ENSv2 remaining on L1 ([ENS blog](https://ens.domains/blog/post/ens-staying-on-ethereum)) means this L1/L2 split is not scheduled to go away.
- Testnet should pair **Ethereum Sepolia ENS** with **Base Sepolia registry**, not look for `.eth` on Base Sepolia.

This note does not choose **OE id**-only v1 vs **linked ENS** in v1.

---

## Sources

- [ENSIP-1: ENS](https://docs.ens.domains/ens-improvement-proposals/ensip-1-ens)
- [EIP-137: Ethereum Domain Name Service](https://eips.ethereum.org/EIPS/eip-137)
- [ENS registry](https://docs.ens.domains/registry/ens)
- [ENSRegistry.sol](https://github.com/ensdomains/ens-contracts/blob/master/contracts/registry/ENSRegistry.sol)
- [ETH registrar](https://docs.ens.domains/registry/eth)
- [Name Wrapper overview](https://docs.ens.domains/wrapper/overview)
- [Name Wrapper (ens-contracts)](https://ensdomains-ens-contracts.mintlify.app/contracts/wrapper/overview)
- [Name Wrapper states](https://ensdomains-ens-contracts.mintlify.app/contracts/wrapper/states)
- [INameWrapper.sol](https://github.com/ensdomains/ens-contracts/blob/master/contracts/wrapper/INameWrapper.sol)
- [Resolution](https://docs.ens.domains/resolution)
- [Integrating ENS](https://ensdomains-ens-contracts.mintlify.app/guides/integrating-ens)
- [Deployments](https://docs.ens.domains/learn/deployments)
- [ens-contracts deployments (staging)](https://github.com/ensdomains/ens-contracts/tree/staging/deployments)
- [ENS contract deployments wiki](https://github.com/ensdomains/ens-contracts/wiki/ENS-Contract-Deployments)
- [ENSIP-10: Wildcard resolution](https://docs.ens.domains/ens-improvement-proposals/ensip-10-wildcard-resolution)
- [Offchain / L2 resolvers (CCIP-read)](https://docs.ens.domains/resolvers/ccip-read)
- [EIP-3668: CCIP Read](https://eips.ethereum.org/EIPS/eip-3668)
- [ENSIP-19: Multichain primary names](https://docs.ens.domains/ensip/19)
- [ENS is staying on Ethereum](https://ens.domains/blog/post/ens-staying-on-ethereum)
- [EIP-1186: eth_getProof](https://eips.ethereum.org/EIPS/eip-1186)
- [Base predeploys](https://docs.base.org/base-chain/specs/protocol/execution/evm/predeploys)
- [OP Stack predeploys](https://specs.optimism.io/protocol/predeploys.html)
- [L1Block.sol](https://github.com/ethereum-optimism/optimism/blob/develop/packages/contracts-bedrock/src/L2/L1Block.sol)
- [Base contract addresses](https://docs.base.org/base-chain/network-information/base-contracts)
- [Base messengers](https://docs.base.org/base-chain/specs/protocol/bridging/messengers)
- [Base deposits](https://docs.base.org/base-chain/specs/protocol/bridging/deposits)
- [Base bridging](https://docs.base.org/base-chain/network-information/bridging-and-withdrawals)
- [Connect to Base](https://docs.base.org/base-chain/quickstart/connecting-to-base)
- [deployments/base](https://github.com/ensdomains/ens-contracts/tree/staging/deployments/base)
- [deployments/baseSepolia](https://github.com/ensdomains/ens-contracts/blob/staging/deployments/baseSepolia/L2ReverseRegistrar.json)
- [EIP-4788: Beacon block root](https://eips.ethereum.org/EIPS/eip-4788)
