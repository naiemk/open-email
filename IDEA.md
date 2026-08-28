# open-email

**Your mailbox is bound to a name, not to a server.** Opt into any compatible node, see the same mail. Leave a node, it can no longer receive for you.

This document is the design brief after grilling. It replaces the earlier draft (auto-assigned `alice.eth`, IMAP in v1, gateway SQLite as source of truth, “stateless gateway,” DEK on the server for SMTP out).

---

## The promise

Portability is the product. Gmail and Proton own the mailbox. We do not.

- **Identity** lives in the **open-email registry** (a contract), not in a vendor database and not as an ENS NFT we custody.
- **Mail blobs** live on a data-availability layer (IPFS or similar).
- **The index** `(user, time, CID)` lives on **index nodes**, not on one SMTP host.
- **Nodes** (SMTP servers with domains) are doors. You **opt in** (and out) with a signature recorded on-chain. A node you have not opted into answers Gmail with **user does not exist**.

What we are **not** claiming: nation-state censorship resistance, E2EE of Gmail traffic, or names that work outside this ecosystem. Inbound and outbound SMTP with the rest of the internet is **plaintext at the opted-in node**, then encrypted at rest.

---

## Who it is for

1. People who want email without a company owning the mailbox.
2. Crypto-native users who already have an ENS name and want that string as their mailbox id.

Passwordless UX (passkeys, no wallet in the default path) is how we make (1) possible. It is not the promise.

---

## Identity

The **open-email registry** is the source of truth for names. Portable across all open-email nodes. **Not** portable outside this ecosystem (except you still own your ENS NFT if you linked one).

Two kinds of mailbox id:

| Kind | Example SMTP local-part | How you get it |
|------|-------------------------|----------------|
| **OE id** | `alice` (no `.`) | Registry assigns/registers it. Must not contain `.`, so it cannot collide with ENS. |
| **Linked ENS** | `vitalik.eth` | You **prove ownership** (sign). Registry stores the string. **NFT stays in your wallet.** No deposit, no withdraw. |

Gmail still needs a domain: `alice@slick.email` and `vitalik.eth@slick.email`. From Gmail’s point of view those are different addresses if the domain differs. We do not care. From open-email’s point of view the mailbox is the registry name.

**We do not mint `.eth` names from the contract.** No `alice.openemail.eth`. If `alice.eth` is already taken (usual case), the user gets a dotless OE id.

Signup for someone without a wallet: FaceID → relayer submits registry txs (Account Abstraction / P-256). Gas is paid from subscription/storage, not from a wallet UI.

---

## Nodes (SMTP)

v1 speaks **SMTP only**. Anyone may later build an IMAP adaptor; it is not in this version.

- Servers **register** (server key on-chain). Stake can be added later.
- The user **opts in / opts out** of a server key. Time of opt-in/out is on-chain.
- **Many nodes at once.** All opted-in nodes may ingest; the user sees the same mailbox on all of them. Opt-out stops **new** receive on that key.
- Unauthorized node: SMTP **550 user unknown**. No receive, no pin, no index. Mail that was never accepted is null. Portability is among nodes you chose, not “anyone on the internet can inject.”
- Anyone can publish junk to IPFS. **Indexers ignore** blobs not from a server the user had authorized at that time.

Opt-in is an on-chain write with **no wallet UI**: WebAuthn/P-256 signature, **protocol relayer** posts the transaction. A server must not be able to opt you into itself.

---

## Keys and encryption

| Role | What it is |
|------|------------|
| **WebAuthn** | Auth + PRF → per-device **KEK**. KEK never leaves the device, never on-chain. |
| **DEK** | User **keypair** (not a symmetric “data key” in the usual sense). Private half wrapped by each device KEK. Wrapped blobs stored (on-chain pointer / IPFS). **Public half** published for envelope encryption. Private half **never** on a node. |
| **OTK** | Per-message key inside the envelope. Encrypts one blob, **including metadata** (headers live inside the sealed object, not as plaintext index fields). |
| **PGP** | Same `DEK_public`, second encoding (WKD / ENS text / OpenPGP packet) so Thunderbird and other PGP users can encrypt to you. Open-email nodes can use a simple envelope (e.g. HPKE); they do not need to be a full OpenPGP stack on day one. |

**E2EE** holds when the sender encrypts to `DEK_public` (open-email user or PGP user). **Encrypt-at-rest** holds for Gmail/Outlook SMTP: the opted-in node sees plaintext, encrypts to `DEK_public`, writes the blob. The node does **not** need the DEK private key to encrypt inbound.

**Sent copy:** client (or node, for the SMTP-out path) stores an envelope-encrypted copy. For outbound to Gmail the node must see plaintext to send; the stored copy is still wrapped so the index/DA never need the DEK.

**Index tuple** `(user, time, CID)` is visible to indexers (they must query by user). “Encrypted metadata” means RFC822 headers **inside the blob**, not the index row.

Web app decrypts in the browser. A hosted IMAP server that Apple Mail talks to remotely would need plaintext; that is why IMAP is not v1.

---

## Data availability and index

**DAL = storage + index.**

- **Storage:** IPFS or similar. Registration/storage fees pay pinning. The protocol specifies publish-blob → CID; the first implementation is IPFS-like, swappable later.
- **Index:** nodes we run (and later others). Simple DB. **Sequential read/write.** Several index nodes for availability. They serve `(user, time, CID)`.
- SMTP nodes do not own the log. They pin a blob, then write to index nodes. Index nodes assign sequence numbers. Writers are authenticated as an opted-in server key.

---

## Mail flows

**Inbound from Gmail**

1. MX of an **opted-in** node receives `name@that-node.com`.
2. If the local-part is not a registry name, or this node is not opted in → **user does not exist**.
3. Spam checks (e.g. Rspamd) on plaintext.
4. Encrypt to `DEK_public` (envelope, metadata inside). Pin to storage. Index `(user, time, CID)`.
5. Unpaid mail is **delivered**. Paid mail (below) is **priority**.

**Outbound to Gmail**

- Send **only** through an opted-in node. `From:` is `name@that-node.com`. DKIM/SPF of that node.
- v1 may use a **shared outbound relay** so new nodes are not dead on IP reputation.
- Plaintext at the node for SMTP; sealed sent-copy on DA.

**Read path (v1)**

- **Web app:** passkey, pull index, fetch CIDs, unwrap DEK with KEK, decrypt locally.

---

## Payment

- **On-chain (audience B):** pay the registry directly (trustless-commerce-style pay link / on-chain payment). Storage + activation.
- **Fiat (audience A, default in the web app):** subscription to an opted-in node. That node is a **reseller**: charges the user, pays the registry/DA/relayer in the background.

Activating a name requires **registration + storage paid**. An ENS name is not a mailbox until it is in our registry and paid.

**Pay-to-reach (priority, not a separate product):** payer locks a payment with a **hash** on-chain; the email reveals the **pre-image**. Valid proof → priority. Unpaid Gmail still arrives if it passes SMTP spam checks. Social recovery of keys is **later**, not this mechanism.

---

## Recovery

- At signup: a **recovery secret** (printable / offline) that wraps the DEK. This is v1, not a later phase.
- Lose every device **and** the secret → mailbox is gone. Honest.
- **Social recovery (guardians):** roadmap, not v1.

---

## v1 vs later

| In v1 | Not in v1 |
|-------|-----------|
| Registry, OE ids, ENS **link by proof** | Minting `.eth` from our contract |
| WebAuthn + relayer (no wallet UI for A) | Wallet-required default path |
| SMTP in/out + web app | IMAP, Apple Mail / Thunderbird against a public host |
| IPFS-like storage + sequential index nodes | Modular DA chains as a hard dependency |
| Multi-node opt-in, bounce if not opted in | Open append to the index |
| Encrypt-at-rest + PGP publication of `DEK_public` | Claiming Gmail traffic is E2EE |
| Recovery secret | Social recovery |
| Pay-to-reach hash/pre-image | Paid-access as the whole product |
| Outbound via opted-in node (+ shared relay) | Neutral protocol-wide From: domain |

---

## Honest boundaries

- **SMTP edge sees plaintext** for mail to/from Gmail, Outlook, etc.
- **Indexers see who got mail and when.**
- **Gmail contacts keep a domain-specific address.** Changing nodes does not rewrite other people’s address books. Portability is *our* mailbox, not *their* To: line.
- **Names do not work as ENS outside open-email** unless the user already owned that ENS and only linked it.
- **A node you opted into can read inbound/outbound SMTP** for as long as it is ingesting. Encryption-at-rest protects DA and other nodes, not that SMTP operator. Opt-out stops *future* receive on that key.
