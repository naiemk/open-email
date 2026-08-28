# DAL storage and sequential index (tracer)

Ticket: [#7](https://github.com/naiemk/open-email/issues/7).
Question: for the tracer **DAL**, what storage (IPFS Kubo, a content-addressed local store, Arweave) and what sequential **index** `(name, time, CID)` can two **nodes** write to, with indexers ignoring unauthorized publishers?

Tracer-scale only: two SMTP **nodes**, no production replication. This note cites primary sources (IPFS/Kubo docs and specs, IPLD, Arweave node HTTP API). It does not implement product code.

## Terms

From `CONTEXT.md` / `IDEA.md`:

- **DAL**: storage plus index. Content-addressed blobs (IPFS or similar) and sequential `(name, time, CID)` index nodes.
- **Index**: the ordered log of `(name, time, CID)`. SMTP **nodes** write to it; they do not own it.
- **Node**: a registered SMTP server with a domain and a server key. It may receive for a **name** only while that user is **opted in**.
- **Name**: the stable mailbox id in the registry (OE id or linked ENS).
- **Opt-in**: on-chain, time-stamped authorization of a **node**'s server key for a mailbox. Indexers ignore blobs not from a server the user had authorized at that time.

Design brief: SMTP **nodes** pin a blob, then write to index nodes. Index nodes assign sequence numbers. Writers are authenticated as an opted-in server key. Anyone can publish junk to IPFS; the **index** is the gate.

## Storage

Three candidates. All can hold sealed mail blobs. None of them, by themselves, are a sequential `(name, time, CID)` **index** that two **nodes** can append to under a registered server key.

### IPFS Kubo

A content identifier (CID) is an address derived from the content's cryptographic hash. The same bytes, added on two **nodes** with the same codec/hash/chunking settings, produce the same CID ([IPFS content addressing](https://docs.ipfs.tech/concepts/content-addressing/)). A CID does not say where the bytes live.

Kubo exposes an HTTP RPC API on the daemon (default `127.0.0.1:5001`). The CLI uses that API when the daemon is running ([Kubo RPC API](https://docs.ipfs.tech/reference/kubo/rpc/)). Relevant write/read surfaces:

| RPC | Role |
| --- | --- |
| [`POST /api/v0/add`](https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-add) | Import bytes as UnixFS. `pin` defaults to `true`. Returns `Hash` (CID). `cid-version=1` is the future-proof path. `trickle=true` builds a trickle DAG (UnixFS layout that favors sequential append; see [content addressing](https://docs.ipfs.tech/concepts/content-addressing/)). |
| [`POST /api/v0/block/put`](https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-block-put) | Store a raw block. Default `cid-codec=raw`. `pin` defaults to `false`. |
| [`POST /api/v0/dag/put`](https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-dag-put) | Store a structured IPLD node. Default `store-codec=dag-cbor`. Suitable for index *entries* (a CBOR object with links), not for the sequential log itself. |
| [`POST /api/v0/pin/add`](https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-pin-add) | Pin an existing CID so garbage collection will not delete it. |
| [`POST /api/v0/block/get`](https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-block-get) / `cat` | Read bytes by CID. |

Persistence is pinning, not the network. Kubo garbage-collects unpinned cached blocks. `ipfs add` pins recursively by default. Objects in the Mutable File System (MFS) are also protected from GC ([pin files](https://docs.ipfs.tech/how-to/pin-files/); [persistence](https://docs.ipfs.tech/concepts/persistence/)). IPFS does **not** guarantee that a CID stays available if nobody pins it ([persistence](https://docs.ipfs.tech/concepts/persistence/): "While IPFS guarantees that any content on the network is discoverable, it doesn't guarantee that any content is persistently available").

Two **nodes** can both write blobs:

- **Shared daemon (tracer-shaped).** Both SMTP processes `POST /api/v0/add?pin=true` to one localhost Kubo. One pin set, one disk. RPC is admin-level (`/api/v0/config` included) and is bound to localhost on purpose. Never expose it to the public internet ([Kubo RPC API](https://docs.ipfs.tech/reference/kubo/rpc/)).
- **Two daemons.** Each **node** adds and pins locally. The CID is the same for the same bytes, but the other daemon only has the bytes if they are transferred (Bitswap / peering) or re-added. Tracer-scale: share one daemon instead.

Kubo RPC auth is **daemon access**, not registry server-key auth. When `API.Authorizations` is set, requests need an `Authorization` header whose secret matches an entry, and the path must be in that entry's `AllowedPaths`. Secrets are `basic:user:pass` or `bearer:token`. `AllowedPaths` can be narrowed, e.g. Alice to `/api/v0/id` and `/api/v0/files`, Bob to `/api/v0` ([Kubo `API.Authorizations`](https://github.com/ipfs/kubo/blob/master/docs/config.md#apiauthorizations)). That can keep two tracer processes from rewriting Kubo config. It does **not** bind a write to an opted-in server key, and it does **not** stop anyone who can talk to a public gateway from publishing a junk CID.

Anyone can add any bytes and get a CID. The design brief already states this: indexers ignore unauthorized publishers. Kubo has no "only this server key may create this CID" check.

### Content-addressed local store

This is Kubo's blockstore without treating the public swarm as a requirement.

- [`ipfs block put`](https://docs.ipfs.tech/how-to/work-with-blocks/) writes raw bytes and returns a CID. [`ipfs block get <cid>`](https://docs.ipfs.tech/how-to/work-with-blocks/) reads them back. Those commands are the local CAS.
- Same CID rules as above: hash + codec. CIDv1 with `raw` on a single block hashes the file bytes directly ([content addressing](https://docs.ipfs.tech/concepts/content-addressing/)).
- Kubo RPC accepts a global `offline` flag on every command ([Kubo RPC global options](https://docs.ipfs.tech/reference/kubo/rpc/)). IPNS publish has `allow-offline` to write the local datastore without broadcasting ([`/api/v0/name/publish`](https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-name-publish)).

A tracer that only needs "put blob → CID → get blob" can run one Kubo on localhost, pin on add, and never join the public DHT. A custom directory of files named by CID is the same idea with more glue and no Bitswap if a second daemon appears later.

This option does not add a sequential **index**. It is storage only.

### Arweave

Arweave is a paid, signed, eventually-mined byte store. Nodes speak HTTP on port 1984 ([Arweave HTTP API](https://docs.arweave.org/developers/arweave-node-server/http-api)).

Write path:

- `POST /tx` with a JSON transaction. `format` 1 or 2 (v1 deprecated; ECDSA needs `format=2`).
- `data` / `data_root` / `data_size` carry the payload. v1 data max 10 MiB; v2 inline `data` accepted up to 12 MiB by nodes at the time the docs were written. Larger payloads use `POST /chunk` after the header is registered.
- `reward` is the fee (winstons). Fee estimate: `GET /price/{bytes}` (legacy) or `GET /price2/{bytes}` ([denomination](https://docs.arweave.org/developers/development/overview/denomination)).
- `tags`: name/value pairs, Base64URL in the JSON, **total names+values ≤ 2048 bytes**.
- `owner` is the RSA public modulus (or empty for ECDSA). Wallet address is SHA-256 of that modulus.
- Signature covers `format`, `owner`, `target`, `data_root`, `data_size`, `quantity`, `reward`, `last_tx`, `tags` (ECDSA omits `owner`). RSA-PSS/SHA-256, or 65-byte recoverable ECDSA ([HTTP API — Transaction Signing](https://docs.arweave.org/developers/arweave-node-server/http-api)).

Read path: `GET /{id}` or `GET /tx/{id}/data.{extension}` for bytes; `GET /tx/{id}/{field}` for `owner`, `tags`, etc. Field/data reads return **202 `pending`** until the tx is in a block.

Two **nodes** can both `POST /tx` from two wallets (or one shared wallet). The identifier is a transaction id, not an IPFS CID. Mapping "CID" onto Arweave means either storing the IPFS CID in a tag and the blob as `data`, or treating the Arweave tx id as the blob address and dropping IPFS.

The core node API has **no** query-by-tag or query-by-mailbox-**name**. Discovery of "all txs for this **name** from these owners" is GraphQL on gateways, not the protocol HTTP API ([Arweave GraphQL guide](https://gql-guide.arweave.dev/): `transactions(owners:[...], tags:[...])`; [AR.IO Find Data](https://docs.ar.io/build/access/find-data/): GraphQL finds ids, REST fetches bytes).

Tracer-unfriendly: needs AR in a wallet, confirmation delay (`pending`), permanent public test mail, 2048-byte tag cap, and no native sequential `(name, time, CID)` log.

## Sequential index `(name, time, CID)`

The **index** must be append-only, readable in order, writable by two opted-in **nodes**, and ignorable for anyone else. Storage systems above do not provide that tuple as a first-class multi-writer log.

### What does not work as the tracer index

**IPNS as one shared pointer.** An IPNS name is the hash of a public key. Only the private-key holder can sign a new record ([IPNS spec](https://specs.ipfs.tech/ipns/ipns-record/): "whoever controls the private key has full control over the name"). Records carry `Value` (usually `/ipfs/<cid>`), `Validity`, `Sequence`, `TTL`, and `signatureV2`. Resolvers pick the highest `sequence` among valid signatures. Two SMTP **nodes** cannot append to one IPNS name unless they share that private key — which is one writer, not two authenticated server keys. DHT records expire after 48 hours and need republish (Kubo default `Ipns.RepublishPeriod` 4 hours) ([IPNS concepts](https://docs.ipfs.tech/concepts/ipns/)). Tracer-local publish is possible with `allow-offline`; that still does not make IPNS multi-writer.

**Per-node IPNS logs, merged at read.** Each **node** holds its own IPNS key and publishes a DAG of its own `(name, time, CID)` entries. Indexers resolve only names whose keys match opted-in server keys and merge by `time`. That matches "ignore unauthorized publishers" (unsigned / unknown keys fail verification). Sequence is per publisher, not global. DHT slowness and republish are wrong for a tracer; `allow-offline` only helps a single Kubo.

**Kubo MFS (`/api/v0/files/write`).** MFS is a per-daemon mutable tree. Writes can create/truncate/offset a file ([`files/write`](https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-files-write)). MFS is not pinned by default but is GC-protected ([pin files](https://docs.ipfs.tech/how-to/pin-files/)). Two processes hitting one daemon race on the same path. Auth is RPC Basic/Bearer, not the registry server key. Not an **index** other **nodes** can treat as protocol state.

**libp2p pubsub.** Kubo has experimental `/api/v0/pubsub/pub` and `/sub`. IPNS-over-pubsub is explicit that PubSub messages are ephemeral and dropped after propagation ([IPNS concepts](https://docs.ipfs.tech/concepts/ipns/)). Not a durable sequential log.

**Arweave tags as the index.** Two wallets can tag txs with a mailbox **name** and a CID. Gateways can GraphQL-filter `owners` + tags and sort by block height. Unauthorized publishers have a different `owner` and drop out of the allow-list. Sequential order is block timestamp/height, not an index-assigned sequence, and is not visible until mined (`202 pending`). Tag budget is 2048 bytes. Fine as a production *discovery* overlay; not a tracer **index**.

**IPLD linked list without a sequencer.** [`dag/put`](https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-dag-put) can store DAG-CBOR objects; DAG-CBOR links are CIDs under CBOR tag 42 ([DAG-CBOR spec](https://ipld.io/specs/codecs/dag-cbor/spec/); [path gateway](https://specs.ipfs.tech/http-gateways/path-gateway/)). A hash-linked list (`{name, time, cid, prev}`) is content-addressed and append-only *per chain*. Two **nodes** appending concurrently fork the chain unless a single process assigns the next `prev` (or they use CRDT/merge). The head still needs a mutable pointer (IPNS or a DB). UnixFS trickle DAGs help sequential *file* layout ([content addressing](https://docs.ipfs.tech/concepts/content-addressing/)); they do not authenticate writers.

### What does work: an authenticated append log the protocol owns

The design brief already names this: "Index: **nodes** we run (and later others). Simple DB. **Sequential read/write.** … Index nodes assign sequence numbers. Writers are authenticated as an opted-in server key."

Tracer shape:

1. SMTP **node** seals the blob, `POST /api/v0/add?pin=true` (or `block/put` + `pin/add`), gets a CID.
2. Same **node** submits `(name, time, CID)` to the **index**, signed with that **node**'s registered server key.
3. The **index** process:
   - verifies the signature;
   - checks **opt-in**: that server key was authorized for this **name** at `time` (tracer: a stub allow-list; later: registry);
   - if not, **ignores** the write (no row);
   - if yes, assigns the next sequence number and appends.
4. Readers list by **name**, in sequence / time order, and fetch CIDs from Kubo.

Two **nodes** both POST. Serialization of sequence numbers is the index's job, not Kubo's. Unauthorized publishers can still dump bytes into IPFS; those CIDs never appear in the **index**.

Implementation at tracer scale can be SQLite, JSONL, or an HTTP handler in front of either. The storage backend is irrelevant as long as append + query-by-**name** is sequential and the auth check sits on the write path.

Optional later: persist each accepted row as a DAG-CBOR block (`dag/put`) so the log is also content-addressed. The *assignment* of sequence and the *rejection* of unauthorized keys stay in the index process.

## Writer auth vs opted-in server key

| Layer | What it authenticates | Enough to ignore unauthorized publishers? |
| --- | --- | --- |
| Kubo RPC `API.Authorizations` | HTTP Basic/Bearer to the daemon | No. Daemon operator, not registry server key. |
| IPFS CID publish | Nothing. Anyone can `add`. | No. |
| IPNS record | Holder of that IPNS private key | Only if that key **is** the registered server key, and each **node** has its own name. Not a shared log. |
| Arweave `owner` + signature | Wallet that paid `reward` | Only if that wallet **is** bound to the registered server key. Filter `owners`. |
| Index write path | Signature of the opted-in server key at `time` | Yes. This is the gate the design brief describes. |

## Tracer recommendation

**Storage: one localhost Kubo.** Both SMTP **nodes** `POST /api/v0/add?pin=true&cid-version=1`. Pinning is the persistence mechanism. Keep RPC on loopback; if the two processes are not on the same host, put Basic/Bearer `API.Authorizations` in front with `AllowedPaths` limited to add/block/pin/cat. Do not use the public swarm, a pinning service, or Filecoin for the tracer.

**Do not use Arweave for the tracer.** Fees, `pending` confirmation, permanent test blobs, 2048-byte tags, and no core query for `(name, time, CID)`. Revisit as a production DA candidate after the index shape is proven.

**Do not build a second local CAS.** Kubo `block/put` / `add` already is one. A CID-named directory is a fallback only if a daemon is unacceptable.

**Index: a small sequential log in front of Kubo, not IPNS/MFS/pubsub/Arweave GraphQL.** Two **nodes** append `(name, time, CID)` signed with their server keys. The log assigns sequence numbers and **ignores** writers who were not **opted in** for that **name** at that `time`. SQLite or JSONL is enough. IPNS-per-**node** or DAG-CBOR hash chains can wait until a later DAL that must survive the index process dying.

That split matches the glossary: blobs are content-addressed and swappable; the **index** is the ordered, authorized log **nodes** write to and do not own.
