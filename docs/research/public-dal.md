# Public DAL: who pins, who signs the index, how a node UI reads

Ticket: [#23](https://github.com/naiemk/open-email/issues/23).
Question: for a public **node** UI, what **DAL** (blobs + **index**) can actually run — self-hosted Kubo plus an index process, a pinning service, or something else? Who pins, who signs **index** nodes, and how does the **node** UI read them?

This is the public-gap companion to [the tracer DAL note](https://github.com/naiemk/open-email/blob/research/dal-index/docs/research/dal-index.md) (`research/dal-index`). That note covers two SMTP **nodes** talking to one localhost Kubo and a sequential signed **index**. This note updates the same split against current first-party sources (Kubo RPC/config, IPFS gateway/IPNS specs, pinning-service APIs). It does **not** pick the product DAL.

## Terms

From `CONTEXT.md`:

- **DAL**: storage plus index. Content-addressed blobs and sequential `(name, time, CID)` index nodes.
- **Index**: the ordered log of `(name, time, CID)`. SMTP **nodes** write to it; they do not own it.
- **Node**: an email-provider instance with a domain, SMTP, a web UI, and a registered server key. The user uses that **node**'s UI; UIs do not talk to other **nodes**.
- **Name**: the stable mailbox id in the registry (OE id or linked ENS).
- **Mailbox**: blobs on the DAL plus index entries for that **name**.

Design brief (`IDEA.md`): SMTP **nodes** pin a blob, then write to index nodes. Index nodes assign sequence numbers. Writers are authenticated as an opted-in server key. Anyone can publish junk to IPFS; the **index** is the gate.

## The public gap

The tracer DAL is loopback: both SMTP processes `POST` to `127.0.0.1:5001`, pin on add, and append to a local sequential log. A public **node** UI is a browser on another origin. That changes three things the tracer never had to answer:

1. **Who holds bits when the SMTP host is offline.** Pinning is local unless someone else pins too.
2. **What a browser is allowed to call.** Kubo RPC is an admin API, not a public HTTP API.
3. **Where the signed `(name, time, CID)` log lives** so the UI can list a **mailbox** without talking to Kubo RPC.

Storage and index stay separate. Pinning a CID does not append an index row. Listing pins is not listing a mailbox.

## Who pins (blob persistence)

IPFS does not keep a CID alive because it is a CID. Nodes garbage-collect unpinned cached blocks. Pinning (or adding the object to MFS) is what exempts data from GC. The network guarantees discoverability of content that *is* on the network, not persistent availability if nobody pins ([persistence](https://docs.ipfs.tech/concepts/persistence/); [pin files](https://docs.ipfs.tech/how-to/pin-files/)).

### Self-hosted Kubo

Kubo RPC is generated from Kubo v0.43.0 (docs dated 2026-08-03). Relevant write/read surfaces ([Kubo RPC API](https://docs.ipfs.tech/reference/kubo/rpc/)):

| RPC | Role |
| --- | --- |
| [`POST /api/v0/add`](https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-add) | Import bytes as UnixFS. `pin` defaults to `true`. Returns a CID. |
| [`POST /api/v0/pin/add`](https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-pin-add) | Pin an existing CID so GC will not delete it. Recursive by default. |
| [`POST /api/v0/pin/remote/add`](https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-pin-remote-add) | Ask a remote pinning service (Pinning Service API client) to pin a CID. |
| [`POST /api/v0/block/get`](https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-block-get) / `cat` | Read bytes by CID. |

Persistence is still pinning on *this* daemon's disk. A public mailbox needs that daemon (or another pin holder) up when a reader asks. Kubo can also pin remotely: `ipfs pin remote service add <nickname> <endpoint> <accessToken>` then `ipfs pin remote add` ([work with pinning services](https://docs.ipfs.tech/how-to/work-with-pinning-services/); [Kubo config `API.Authorizations`](https://github.com/ipfs/kubo/blob/master/docs/config.md#apiauthorizations) is unrelated to that client — it authenticates callers of *this* daemon).

**Auth is daemon access, not registry server-key auth.** Default: RPC on `127.0.0.1` with an Origin check. When `API.Authorizations` is set, requests need `Authorization` whose secret matches an entry, and the path must be in that entry's `AllowedPaths`. Secrets are `basic:user:pass` or `bearer:token` ([Kubo `API.Authorizations`](https://github.com/ipfs/kubo/blob/master/docs/config.md#apiauthorizations); [Kubo RPC Authentication](https://docs.ipfs.tech/reference/kubo/rpc/)).

**A browser must not call Kubo RPC.** Official docs:

- "NEVER EXPOSE THE RPC API TO THE PUBLIC INTERNET." It includes `/api/v0/config` and is bound to localhost on purpose. For browsers and the public internet, use the HTTP Gateway instead ([Kubo RPC API](https://docs.ipfs.tech/reference/kubo/rpc/)).
- Browser requests without a safelisted `Origin` get HTTP 403 (Origin / CORS). Safelist is `API.HTTPHeaders.Access-Control-Allow-Origin` ([Kubo RPC — Origin-based security](https://docs.ipfs.tech/reference/kubo/rpc/)).
- Config repeats the same split: keep `Addresses.API` on localhost unless `API.Authorizations` is configured; the interface designed for browsers is `Addresses.Gateway` ([Kubo config](https://github.com/ipfs/kubo/blob/master/docs/config.md#apiauthorizations)).

So the SMTP **node** (server-side) can `add`/`pin`/`pin remote`. The **node** UI cannot.

### Pinning services (first-party)

A remote pinning service holds pins on *its* nodes so the local daemon's uptime and disk are not the only persistence ([pin files — local vs remote](https://docs.ipfs.tech/how-to/pin-files/); [persistence — pinning services](https://docs.ipfs.tech/concepts/persistence/)). The vendor-agnostic surface is the [IPFS Pinning Service API](https://github.com/ipfs/pinning-services-api-spec/blob/master/ipfs-pinning-service.yaml) (spec frozen; Kubo still speaks it). It models pin requests: `cid`, optional `name` / `origins` / `meta`, a `requestid`, and status `queued|pinning|pinned|failed`. It does not model a sequential `(name, time, CID)` log, server-key signatures, or opt-in.

As of the IPFS docs page (notes June 2023), Filebase and Pinata implement that endpoint ([work with pinning services](https://docs.ipfs.tech/how-to/work-with-pinning-services/)).

#### Pinata

Who holds bits: Pinata's nodes. Upload pins bytes and returns `IpfsHash` (CID) ([Pin File to IPFS](https://docs.pinata.cloud/api-reference/endpoint/ipfs/pin-file-to-ipfs) — `POST https://api.pinata.cloud/pinning/pinFileToIPFS`, `Authorization: Bearer` JWT). Pin an already-published CID with `POST https://api.pinata.cloud/v3/files/public/pin_by_cid` (`cid` required; optional `name`, `group_id`, `keyvalues`, `host_nodes`) ([Pin by CID](https://docs.pinata.cloud/api-reference/endpoint/pin-by-cid); [SDK `upload.public.cid`](https://docs.pinata.cloud/sdk/upload/public/cid)).

CID retrieval: dedicated gateway, path form `https://{gateway}.mypinata.cloud/ipfs/{cid}`. Restricted by default to CIDs pinned to that account; opening it to the public swarm requires a Gateway Access Control ([Dedicated IPFS Gateways](https://docs.pinata.cloud/gateways/dedicated-ipfs-gateways); [Retrieving Files](https://docs.pinata.cloud/gateways/retrieving-files)). Private IPFS is a different network: no public announce; access is a time-limited link ([Private IPFS](https://docs.pinata.cloud/files/private-ipfs)).

Pricing (first-party pricing page): Free $0/mo (1 GB storage, 500 files, 10 GB bandwidth, 10K requests, 1 gateway). Picnic $20/mo (1 TB, extra storage $0.07/GB, 500 GB bandwidth extra $0.10/GB, 1M requests extra $0.20/10k). Fiesta $100/mo (5 TB extra $0.035/GB, 2.5 TB bandwidth extra $0.08/GB). Gateway bandwidth and requests reset monthly ([Pinata pricing](https://www.pinata.cloud/pricing); [Billing](https://docs.pinata.cloud/account-management/billing)).

Auth on write APIs is Pinata JWT (`org:files:write`), not a registry server key.

#### Filebase

Who holds bits: Filebase IPFS buckets. Three pin paths ([Pinning files](https://docs.filebase.com/code-development-+-sdks/sdk-examples-pinning-files-and-folders-to-ipfs/aws-sdk-for-javascript.md)):

1. Console upload (CID appears in object metadata).
2. S3 API `https://s3.filebase.com`; CID returned as `x-amz-meta-cid`.
3. Re-pin an existing CID via Pinning Service API.

PSA base URL `https://api.filebase.io/v1/ipfs/pins`, `Authorization: Bearer` per-bucket token, 100 req/s. `POST` body: `cid` required, optional `name` (≤ 255 chars), `origins`, `meta`. List supports `cid`, `name`/`match`, `status`, `before`/`after` (ISO 8601 queue time), `limit`, `meta`. Kubo registers the service root `https://api.filebase.io/v1/ipfs` ([Filebase IPFS Pinning Service API](https://docs.filebase.com/api-documentation/ipfs-pinning-service-api)).

Pricing (first-party): Free $0/mo — 5 GB storage, 500 pinned files, 1 IPNS name, 1 gateway+CDN, 1 GB IPFS egress. Pro $7.50/mo — 500 GB, unlimited pinned files, 100 IPNS names, 5 gateways+CDN, 250 GB IPFS egress; extra IPFS storage and bandwidth $0.015/GB. Object-storage egress on paid plans is free; IPFS egress is not ([Filebase pricing](https://filebase.com/pricing/); [Pricing docs](https://filebase.com/docs/account/pricing)).

Auth is Filebase bearer / S3 keys, not a registry server key. `meta` and `name` are operator labels, not signed index tuples.

#### Storacha (web3.storage successor)

First-party GitHub: client hashes locally, uploads to `https://up.storacha.network`, retrieves via any IPFS gateway, documented as `https://storacha.link/ipfs/<root cid>` ([storacha/upload-service](https://github.com/storacha/upload-service)). All uploaded data is available to anyone with the CID ([`@storacha/client` README](https://github.com/storacha/upload-service/tree/main/packages/w3up-client)). Auth is UCAN capability delegation to a Space (`did:key`), not a registry server key ([UCANs and Storacha](https://docs.storacha.network/concepts/ucans-and-storacha/) — this page still served Storacha content when fetched; several other `docs.storacha.network` URLs redirected to an unrelated Fil One marketing site, so pricing is not cited from there).

### Who pins in a public mailbox (facts, not a pick)

| Actor | Can pin? | Notes |
| --- | --- | --- |
| SMTP **node** process | Yes | Kubo RPC on loopback, and/or pinning-service HTTP with a server-held token. |
| Pinning-service account | Yes | Holds bits while the bill is paid ([persistence](https://docs.ipfs.tech/concepts/persistence/): if the sponsor stops paying, content may be lost). |
| **Node** UI (browser) | No (Kubo RPC); only if a JWT were shipped to the page (pinning APIs) | Shipping a pinning JWT to the browser is the pinning-service's account credential, not opt-in. |
| Public IPFS peers | Cache, then GC | Not a persistence plan. |

Unauthorized SMTP still can `add` bytes and get a CID. Pinning services will pin whatever CID the token holder asks. Neither layer is the opt-in gate.

## Who signs index nodes

The tracer **index** is a custom sequential log: the **node** submits `(name, time, CID)` signed with its registered server key; the index process verifies, checks opt-in at `time`, ignores failures, assigns sequence. That protocol is not IPFS. The question is whether an existing system can *serve* that tuple with server-key signatures.

### IPNS (one mutable pointer)

An IPNS name is the hash of a public key. "Whoever controls the private key has full control over the name." Records carry `Value` (usually `/ipfs/<cid>`), validity, sequence, TTL, and `signatureV2`. Resolvers pick the highest sequence among valid signatures ([IPNS record spec](https://specs.ipfs.tech/ipns/ipns-record/); [IPNS concepts](https://docs.ipfs.tech/concepts/ipns/)).

Facts that block using one IPNS name as the protocol **index**:

- One private key = one writer. Two SMTP **nodes** cannot append unless they share that key (one writer, not two authenticated server keys).
- A record points at a path, not at a growing `(name, time, CID)` log. You can publish a new CID of a file that *contains* the log, but concurrent publishers still fork unless a sequencer assigns the next head.
- DHT records expire after 48 hours and need republish (Kubo default `Ipns.RepublishPeriod` 4 hours) ([IPNS concepts](https://docs.ipfs.tech/concepts/ipns/)).
- Gateway `/ipns/{name}` resolution is **trusted**: the client delegates authenticity of the record to the gateway unless it requests `?format=ipns-record` / `Accept: application/vnd.ipfs.ipns-record` and verifies ([IPNS concepts](https://docs.ipfs.tech/concepts/ipns/); [HTTP Gateway](https://docs.ipfs.tech/reference/http/gateway/); [Trustless Gateway spec](https://specs.ipfs.tech/http-gateways/trustless-gateway/)).

Per-**node** IPNS (each server key is an IPNS key, each publishes its own DAG) can prove "this publisher signed this head." Sequence is per publisher, not global. DHT republish and trusted-gateway resolution remain. Filebase sells IPNS names as a product quota (1 on Free, 100 on Pro) ([Filebase pricing](https://filebase.com/pricing/)); that is still IPNS, not a multi-writer sequential log.

### Pinning-service "directory"

PSA `name` / `meta`, Pinata `keyvalues` and Groups, Filebase list filters: these are pin *catalogs* for the account that holds the token.

- PSA list: filter by `cid`, `name`, `status`, `before`/`after` (pin-request time), `meta` ([spec YAML](https://github.com/ipfs/pinning-services-api-spec/blob/master/ipfs-pinning-service.yaml); [Filebase PSA](https://docs.filebase.com/api-documentation/ipfs-pinning-service-api)).
- Pinata Groups: named buckets of file ids; create/list/add/remove; deleting a group does not unpin ([Groups](https://docs.pinata.cloud/files/file-groups.md)). List files can filter by `cid` and metadata ([List Files](https://docs.pinata.cloud/api-reference/endpoint/list-files)).
- Pinata pin-by-CID `keyvalues` are string maps on the pin record ([Pin by CID](https://docs.pinata.cloud/api-reference/endpoint/pin-by-cid)).

None of those APIs: assign a global sequence; verify a registry server key; check opt-in; ignore unauthorized publishers; return `(name, time, CID)` as protocol state. Listing requires the service credential (`org:files:read` / bearer token), so a **node** UI cannot read the catalog unless the JWT is in the page or a backend proxies it. Pinata "signatures" in their docs index are Pinata CID signatures, not opted-in server keys.

### Always-on index process

Still the only surveyed surface that can:

1. Accept appends from more than one **node**.
2. Verify each append against that **node**'s registered server key.
3. Ignore writers who were not **opted in** for that **name** at `time`.
4. Assign sequence.
5. Serve a query-by-**name** list to a browser over ordinary HTTPS.

That process is not Kubo, not PSA, not IPNS. It can persist accepted rows however it wants (SQLite, JSONL, DAG-CBOR blocks via `dag/put`). The *gate* stays in the process. Availability of the **index** is availability of that process (or replicas of it). Availability of *blobs* is whoever pins the CIDs.

No official IPFS spec defines this log. Citing CRDT libraries as if they were the protocol **index** would invent a protocol; this note does not.

## How a node UI reads

Two fetches: the **index** for a **name**, then each blob CID. UIs do not talk to other **nodes** (`CONTEXT.md`); they talk to this **node**'s backend and to whatever public read surfaces that backend chose.

### Index

The UI needs an HTTPS URL that returns ordered `(name, time, CID)` (and enough signature/sequence metadata to verify, if verification is in the client). That URL is the index process (or a reverse proxy in front of it). It is not:

- Kubo RPC (`/api/v0/...`) — admin, localhost, 403 from random origins.
- PSA `GET /pins` — account pin list, bearer token, no opt-in filter.
- `GET /ipfs/{cid}` — that is a blob, not "all index rows for this **name**," unless the UI already knows a head CID (IPNS/DNSLink pointer problem above).

CORS: the index origin must allow the **node** UI origin, or the UI must same-origin through the **node**'s own host. That is ordinary HTTP, not an IPFS constraint.

### Blobs

After the UI has CIDs, retrieval options from official docs:

| Path | What the browser talks to | Verify CID? | CORS / origin |
| --- | --- | --- | --- |
| Kubo RPC `cat` / `block/get` | `127.0.0.1:5001` | Daemon verifies internally; browser never sees this if RPC stays private | Not for browsers ([Kubo RPC](https://docs.ipfs.tech/reference/kubo/rpc/)) |
| Self-hosted HTTP gateway | Kubo `:8080` or Rainbow `:8090` | Deserialized = trust the gateway; `?format=raw`/`car` = client can verify | Kubo/Rainbow send `Access-Control-Allow-Origin: *` by default; do not strip at the proxy ([replace public gateways](https://docs.ipfs.tech/how-to/replace-public-gateways-with-self-hosted-ipfs/)) |
| Pinning-service dedicated gateway | e.g. Pinata `https://{gw}.mypinata.cloud/ipfs/{cid}` | Deserialized unless the client asks trustless types | Browser-reachable HTTPS; Pinata restricted gateways only serve that account's pins ([Retrieving Files](https://docs.pinata.cloud/gateways/retrieving-files)) |
| Public recursive gateway | `https://{gateway}/ipfs/{cid}` | Same trust split | Many support CORS ([gateway best practices](https://docs.ipfs.tech/how-to/gateway-best-practices/)); availability and MITM are the public gateway's ([avoiding centralization](https://docs.ipfs.tech/how-to/gateway-best-practices/)) |

Path vs subdomain: `https://{gateway}/ipfs/{cid}` shares one origin across CIDs (no origin isolation). Subdomain `https://{cid}.ipfs.{gateway}/...` isolates per CID. Path gateways "should not be used for hosting web apps" ([IPFS Gateway](https://docs.ipfs.tech/concepts/ipfs-gateway/); [Address IPFS on the web](https://docs.ipfs.tech/how-to/address-ipfs-on-web/)). A **node** UI that only *fetches* sealed blobs (not hosting a third-party app per CID) still hits CORS and trust; origin isolation matters if those blobs ever execute as documents.

Trusted vs trustless ([HTTP Gateway](https://docs.ipfs.tech/reference/http/gateway/)):

- Default deserialized response: the gateway UnixFS-assembles the file. The client trusts that gateway not to substitute bytes ([gateway MITM](https://docs.ipfs.tech/how-to/gateway-best-practices/)).
- Trustless: `Accept: application/vnd.ipld.raw` / `car` / `vnd.ipfs.ipns-record` (or `?format=`). The client checks bytes against the CID ([Trustless Gateway spec](https://specs.ipfs.tech/http-gateways/trustless-gateway/)).

Kubo `Gateway.NoFetch=true` serves only local repo (non-recursive). `Gateway.DeserializedResponses=false` is trustless-only ([Kubo config](https://github.com/ipfs/kubo/blob/master/docs/config.md#gatewaynofetch)). Writable gateway is **removed** as of Kubo 0.20 — browsers cannot `POST` content through the gateway ([Kubo config `Gateway.Writable`](https://github.com/ipfs/kubo/blob/master/docs/config.md#gatewaywritable)).

Availability: a recursive public gateway may find a CID if *someone* still provides it. A restricted dedicated gateway only has what that account pinned. A non-recursive self-hosted gateway only has what that daemon pinned. The **index** can list a CID that no pin holder still has; the blob fetch then 504s.

## Constraints that survive any pick

1. **Blobs and index are different machines (logically).** Pin APIs persist CIDs. They do not authenticate opted-in server keys or assign `(name, time, CID)` sequence.
2. **The SMTP **node** pins; the UI does not.** Writes go through the **node** process (Kubo loopback and/or pinning-service token). The UI is read-only HTTP.
3. **Someone always-on must pin.** Local Kubo pin = that host's disk and uptime. Pinning service = their nodes and invoice ([persistence](https://docs.ipfs.tech/concepts/persistence/)). Both can be used together (`pin remote`).
4. **Someone always-on must sign/serve the index.** IPNS is one-key mutability plus republish. PSA/groups are pin metadata. The tracer's signed sequential log is still a process the protocol runs.
5. **Browser blob reads are gateways, not RPC.** Prefer a gateway the **node** (or pin provider) actually holds pins on; treat public recursive gateways as a fallback with trust and outage cost.
6. **Deserialized gateway reads trust that gateway.** Verification needs CAR/raw (or a local/in-browser IPFS stack). Sealed envelopes still need the user's **DEK** to decrypt; CID verification only proves the bytes match the index CID.

## What this note does not decide

Which combination to run for the first public mailbox (self-hosted Kubo vs Pinata vs Filebase vs both; where the index process is hosted; whether the UI verifies CAR or trusts a dedicated gateway). Those are product picks. The facts above are the constraints any pick has to satisfy.
