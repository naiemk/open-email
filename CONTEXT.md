# open-email

A portable mailbox bound to a registry name, not to an SMTP host. Compatible nodes are doors the user opts into; mail blobs and the index outlive any one node.

## Language

**Mailbox**:
The user's mail as a whole: blobs on the DAL plus index entries for their **name**. Not a folder on one server.
_Avoid_: account, inbox-on-a-host, Gmail account

**Name**:
The stable mailbox id in the **registry**. Either a dotless **OE id** (`alice`) or a **linked ENS** local-part (`vitalik.eth`).
_Avoid_: username, address (the SMTP address includes a node domain), identity (too vague)

**OE id**:
A registry **name** that contains no `.`, so it cannot collide with ENS.
_Avoid_: username, handle, subname, open-email ENS

**Linked ENS**:
An ENS string recorded in the **registry** after the owner proves control. The ENS NFT never moves.
_Avoid_: deposited ENS, custodied ENS, minted .eth

**Registry**:
The on-chain open-email contract that maps **name** → user (WebAuthn) and records node registration and opt-in/out.
_Avoid_: ENS registrar, ENS registry (different contracts), user database

**Node**:
An email-provider instance: domain, SMTP, its own web app, and a registered server key. The user uses that node's UI; UIs do not talk to other nodes. It may receive and send for a **name** only while that user is **opted in**.
_Avoid_: gateway, host, protocol-wide web client

**Opt-in**:
An on-chain, time-stamped authorization of a **node**'s server key for a **mailbox**. Opt-out ends new receive on that key.
_Avoid_: MX authorization, home server, account signup

**Relayer**:
The protocol component that posts registry transactions from a WebAuthn/P-256 signature so the user never uses a wallet UI.
_Avoid_: custodian, server-signed opt-in

**DEK**:
The user's encryption **keypair**. The private half is wrapped by per-device KEKs; the public half is published for envelopes (and as OpenPGP).
_Avoid_: symmetric data key, server key

**KEK**:
A per-device key derived from WebAuthn PRF, used only to wrap the **DEK** private half. Never on-chain in plaintext.
_Avoid_: passkey (the authenticator), password

**Envelope**:
Per-message encryption: a one-time key seals the blob (including headers); that key is wrapped to `DEK_public`.
_Avoid_: E2EE (only true when the sender encrypted to `DEK_public` before any node saw plaintext)

**DAL**:
Storage plus index: content-addressed blobs (IPFS or similar) and sequential `(name, time, CID)` index nodes.
_Avoid_: gateway database, stateless storage

**Index**:
The ordered log of `(name, time, CID)` maintained by index nodes. SMTP **nodes** write to it; they do not own it.
_Avoid_: mailbox SQLite, IMAP store

**Reseller**:
A **node** operator who charges fiat and pays the **registry** / DAL / **relayer** in the background.
_Avoid_: protocol treasury, Stripe (that's a mechanism)

**Pay-to-reach**:
Priority by on-chain payment: commit a hash, reveal the pre-image in the mail. Unpaid mail that passes SMTP checks still arrives.
_Avoid_: paid email as the product, postage
