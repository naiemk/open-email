# SMTP ingest for a two-node tracer

Ticket: [#6](https://github.com/naiemk/open-email/issues/6).
Question: what is the smallest honest SMTP-in path for two **nodes** (listen, accept one message, hand the RFC 5322 bytes to encryption/DAL)?
Compared: Stalwart, maddy, Haraka, Postfix, a tiny custom SMTP server.
Tests: inject mail with swaks or netcat without a public MX.

This note cites primary sources only (RFCs, official project docs, first-party READMEs). It does not implement product code.

## Terms

From `CONTEXT.md` / `IDEA.md`:

- **Node**: a registered SMTP server with a domain and a server key. It may receive for a **name** only while that user is **opted in**.
- **Mailbox**: the user's mail as a whole (blobs on the **DAL** plus index entries for their **name**). Not a folder on one server.
- **Envelope** (open-email): per-message encryption. The SMTP **envelope** (MAIL FROM / RCPT TO) is a different object; this note says "SMTP envelope" when it means RFC 5321 routing.
- **DAL**: storage plus index. SMTP **nodes** write a blob then an index tuple; they do not own the mailbox.

Inbound from Gmail (design brief): MX of an opted-in **node** receives `name@that-node.com`. If the local-part is not a registry **name**, or this **node** is not opted in → user does not exist. Then encrypt-at-rest to `DEK_public`, pin, index.

## What "honest SMTP-in" is

SMTP is a TCP command/reply protocol. A session starts when a client connects and the server greets with `220` ([RFC 5321 §3.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-3.1)). A mail transaction is three steps ([RFC 5321 §3.3](https://www.rfc-editor.org/rfc/rfc5321.html#section-3.3)):

1. `MAIL FROM:<reverse-path>` — SMTP envelope sender. Accept with `250`, or fail with `550`/`553`.
2. One or more `RCPT TO:<forward-path>` — SMTP envelope recipients. If the recipient is not deliverable, the server returns `550`, typically "no such user" plus the mailbox name.
3. `DATA` — server replies `354`, client sends the message text, terminated by a line containing only `.`. Server replies `250` when the text is stored.

The bytes after `DATA` are the Internet Message Format: a header section, a blank line, then an optional body ([RFC 5322 §2.1](https://www.rfc-editor.org/rfc/rfc5322#section-2.1)). RFC 5322 calls this IMF; operators still say "RFC822". The SMTP envelope (`MAIL FROM` / `RCPT TO`) is not the `From:` / `To:` header fields ([RFC 5321 §2.3.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-2.3.1) vs [RFC 5322 §3.4.1](https://www.rfc-editor.org/rfc/rfc5322#section-3.4.1): the local-part is interpreted on the receiving host as a mailbox name).

For this product, `RCPT TO:<name@node-domain>` is how Gmail addresses a **node**. The local-part is the registry **name**. A **node** the user has not opted into must refuse receive ([IDEA.md](../../IDEA.md) inbound flow). RFC 5321's matching reply is `550` "no such user" ([RFC 5321 §3.3](https://www.rfc-editor.org/rfc/rfc5321.html#section-3.3); sample in [Appendix D.1](https://www.rfc-editor.org/rfc/rfc5321.html#appendix-D.1): `550 No such user here`).

After `DATA`, the **node** holds plaintext IMF bytes. That is the handoff to encryption/DAL: wrap as an open-email **envelope** to `DEK_public`, pin the blob, write `(name, time, CID)` to the index. The SMTP listener must not become the mailbox store.

An SMTP receiver is also expected to prepend its own `Received:` header field ([RFC 5321 §4.4](https://www.rfc-editor.org/rfc/rfc5321.html#section-4.4)). Tiny libraries often skip this; see smtp-server below.

## MX is how clients find a host, not how SMTP works

[RFC 5321 §5.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-5.1) is address resolution for a sending client: look up MX for the recipient domain, else treat an A/AAAA as an implicit MX. That is how Gmail would find a public **node**.

A client that already has an IP and port connects there directly. Appendix D.1 states the assumption explicitly: "here we assume that host bar.com contacts host foo.com directly." Tests that open `127.0.0.1:2525` are still SMTP. They skip DNS, not the protocol.

## How tests inject mail without a public MX

### swaks

Swaks is a purpose-built SMTP transaction tester ([official reference](http://jetmore.net/john/code/swaks/latest/doc/ref.txt), also [GitHub `doc/base.pod`](https://github.com/jetmore/swaks/blob/develop/doc/base.pod)).

- `--to` is the only required option; it sets the SMTP envelope recipient (`RCPT TO`).
- `--server` "explicitly tell Swaks to use network sockets and specify the hostname or IP address to which to connect." If `--server` is omitted, Swaks looks up DNS for the recipient domain. If `--server` is set, that lookup is skipped.
- `--port` selects the TCP port (default smtp/25). `--server HOST:PORT` also works; `--port` wins if both are set.

Two-node tracer, no MX:

```text
swaks --server 127.0.0.1 --port 2525 \
  --from gmail-user@example.com \
  --to alice@node-a.test
```

Second **node**: same command, `--port 2526` and `--to alice@node-b.test`. Unauthorized name: expect `550` on `RCPT TO`.

### netcat

SMTP is a line-oriented TCP dialog ([RFC 5321 §3.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-3.1)–[§3.3](https://www.rfc-editor.org/rfc/rfc5321.html#section-3.3)). Any TCP client that speaks the Appendix D scenario injects mail. Connect to `127.0.0.1` and the **node**'s listen port, then type:

```text
EHLO test.local
MAIL FROM:<gmail-user@example.com>
RCPT TO:<alice@node-a.test>
DATA
From: gmail-user@example.com
To: alice@node-a.test
Subject: tracer

hello
.
QUIT
```

That is the same session as [RFC 5321 Appendix D.1](https://www.rfc-editor.org/rfc/rfc5321.html#appendix-D.1). No MX is involved because the client never looks up a domain.

Prefer swaks in automated tests: it owns SMTP quoting, dot-stuffing ([RFC 5321 §4.5.2](https://www.rfc-editor.org/rfc/rfc5321.html#section-4.5.2)), and transcripts. Use netcat to debug a hanging banner.

## Comparison

Ranked by how little you must run before one RFC 5322 blob reaches encryption/DAL.

### 1. Tiny custom SMTP server (smallest honest path)

A library that speaks RFC 5321, exposes `RCPT TO` and `DATA`, and leaves storage to you. Three first-party options:

#### smtp-server (Node)

Nodemailer's [smtp-server docs](https://nodemailer.com/extras/smtp-server): "not a full-blown mail server application like Haraka. Instead, it provides a convenient way to add custom SMTP or LMTP listeners to your Node.js application." Also useful for testing.

- `server.listen(port[, host])` binds the listener.
- `onRcptTo(address, session, callback)` runs per `RCPT TO`. Reject with `callback(new Error("User unknown"))`.
- `onData(stream, session, callback)` receives a readable stream of the message. "The stream contains the message with SMTP dot-escaping already decoded (the terminating `.` is not included); no other modifications are made — no headers are added or changed." Pipe that stream into encryption/DAL.
- Caveat: "smtp-server does not add a `Received:` header to the message. If you need RFC 5321 compliance, you must add this header yourself."
- Inbound MX note from Nodemailer's [receiving-email guide](https://nodemailer.com/guides/receiving-email): `authOptional: true` for unauthenticated inbound; `server.listen(25)` for a public MX. Tracer: listen on 2525/2526 with auth optional.

GitHub: [nodemailer/smtp-server](https://github.com/nodemailer/smtp-server).

#### aiosmtpd (Python)

[Official handlers](https://aiosmtpd.aio-libs.org/en/stable/handlers.html) and [controller](https://aiosmtpd.aio-libs.org/en/stable/controller.html):

- `Controller(handler, hostname=..., port=8025)` — default port 8025, "convenient to spin up an SMTP server for unit tests."
- `handle_RCPT`: return `'550 not relaying to that domain'` to refuse; append to `envelope.rcpt_tos` to accept. Matches the 550 rule above.
- `handle_DATA`: called after the entire message ("SMTP content" as in RFC 5321) is received. `envelope.original_content` is `bytes`, normalized per [RFC 5321 §4.5.2](https://www.rfc-editor.org/rfc/rfc5321.html#section-4.5.2). Return `'250 Message accepted for delivery'`.
- Built-in `Sink` discards; `Mailbox` writes Maildir. Tracer should not use `Mailbox`: that is a local store, not the DAL.

#### go-smtp (Go)

[emersion/go-smtp README](https://github.com/emersion/go-smtp): "An ESMTP client and server library written in Go" implementing RFC 5321. Go's stdlib `net/smtp` is a frozen *client*; this library is the server. Same shape: implement a backend that sees SMTP envelope + DATA reader, then hand bytes to encryption/DAL.

**Fit for the tracer:** two processes (or two `listen` calls), two ports, stub opt-in on `RCPT TO`, one function on `DATA`. No IMAP, no queue manager, no SPF/MX checks that fail on localhost.

### 2. Haraka (smallest mail *server* that does not own the mailbox)

[Getting started](https://haraka.github.io/getting_started/): "Haraka makes no attempt to be a mail store (like Exchange or Postfix/Exim/Qmail), a LDA, nor an IMAP server. Haraka is typically used with such systems." That matches open-email: the **node** is a door, the **mailbox** is DAL + index.

[Plugins](https://haraka.github.io/core/Plugins/): "Mail cannot even be received unless at least a 'rcpt' and a 'queue' plugin are enabled." Recipient plugins decide whether a recipient is accepted; a queue plugin "queues the message somewhere — normally to disk or to another SMTP server." `hook_rcpt` must `next(OK)` or the sender gets "I cannot deliver for that user." `hook_queue` must `next(OK)` when queuing succeeded.

[Transaction](https://haraka.github.io/core/Transaction/): `transaction.message_stream` is a Node readable stream of the message (`pipe` to a writable). That is the RFC 5322 handoff.

Setup ([getting started](https://haraka.github.io/getting_started/), [core config](https://haraka.github.io/core/CoreConfig/)):

- `npm install -g Haraka` then `haraka -i /path/to/node-a`.
- `config/smtp.ini`: `listen` defaults to `::0:25`; set e.g. `127.0.0.1:2525` for a tracer **node**.
- `config/host_list`: domains this instance accepts (`node-a.test`).
- Default queue is `smtp-forward` to another MTA. Tracer: replace with a custom `hook_queue` that feeds encryption/DAL (or `queue/lmtp` / `queue/smtp_forward` only if the next hop is *your* process).

[Writing plugins](https://haraka.github.io/tutorials/tutorial/): `haraka -p name` scaffolds a plugin; enable it in `config/plugins`.

**Fit:** still a real SMTP server with plugin order, timeouts, and inbound hook sequence aligned with RFC 5321. More moving parts than smtp-server (`config/plugins`, `host_list`, `smtp.ini`). Better when the tracer should look like a **node** daemon rather than a function in the app process. Two Haraka instances = two **nodes**.

### 3. maddy (composable MTA; default store is IMAP)

[README](https://github.com/foxcpp/maddy): "accept messages via SMTP (works as MX) and store messages while providing access to them via IMAP." It replaces Postfix + Dovecot + OpenDKIM/SPF/DMARC. Docs: [maddy.email](https://maddy.email/).

[SMTP endpoint](https://maddy.email/reference/endpoints/smtp/): module `smtp` is an ESMTP listener; messages follow pipeline rules. Example: `destination example.org { deliver_to &local_mailboxes }` / `default_destination { reject }`.

[Default `maddy.conf`](https://github.com/foxcpp/maddy/blob/master/maddy.conf): inbound `smtp tcp://0.0.0.0:25` with `dmarc yes` and `check { require_mx_record dkim spf }`. Unknown destinations: `reject 550 5.1.1 "User doesn't exist"` — the same 550 the product wants. Local routing `deliver_to &local_mailboxes` (imapsql). Comment in the same file: you can instead `deliver_to lmtp tcp://127.0.0.1:8024`.

[`require_mx_record`](https://maddy.email/reference/checks/misc/): "Check that domain in MAIL FROM command does have a MX record." Default action is quarantine. Localhost swaks from `gmail-user@example.com` will trip this unless checks are stripped for the tracer.

Handoff without IMAP: [`target.smtp` / `target.lmtp`](https://foxcpp.github.io/maddy/reference/targets/smtp/) — `deliver_to smtp tcp://127.0.0.1:5353` forwards the message to another listener. That second listener is still the encryption/DAL process. Per **node** you then run maddy *plus* your handler.

**Fit:** honest SMTP and a first-class `550` for unknown users. Wrong default storage model (IMAP/SQL as mailbox). Extra auth checks fight tracer injection. Keep for a later "SMTP edge in front of our process" experiment, not the smallest tracer.

### 4. Postfix (production MTA; queue, then pipe)

[smtpd(8)](https://www.postfix.org/smtpd.8.html): "The SMTP server accepts network connection requests and performs zero or more SMTP transactions per connection. Each received message is piped through the cleanup(8) daemon, and is placed into the incoming queue as one single queue file."

Handoff: [pipe(8)](http://www.postfix.org/pipe.8.html) "delivery to external command." `argv=command...` is required; macros include `${sender}` and `${recipient}`. Default: "a message is copied unchanged."

[FILTER_README](https://www.postfix.org/FILTER_README.html) simple filter: test as `/path/to/script -f sender -- recipient... <message-file` (message on stdin). Then `master.cf`:

```text
filter unix - n n - 10 pipe
  flags=Rq user=filter null_sender=
  argv=/path/to/script -f ${sender} -- ${recipient}
```

and `smtpd` with `-o content_filter=filter:dummy` so SMTP-in is given to that transport instead of local delivery.

**Fit:** battle-tested SMTP-in and a documented byte handoff. Cost: master, queue manager, cleanup, `main.cf`/`master.cf`, privilege drop. Two **nodes** means two Postfix instances (or two `smtpd` listeners with different `content_filter` destinations). Too much queue machinery for "accept one message."

### 5. Stalwart (all-in-one mail + collaboration server)

[README](https://github.com/stalwartlabs/stalwart): JMAP, IMAP4, POP3, SMTP, CalDAV, CardDAV, WebDAV. SMTP includes DMARC/DKIM/SPF/ARC, queues, sieve, milter, MTA hooks. Storage backends: RocksDB, FoundationDB, Postgres, MySQL, SQLite, S3, Azure, Redis. "Encryption at rest with S/MIME or OpenPGP" — that is Stalwart's mailbox crypto, not the open-email **envelope**/DAL.

[Listeners](https://stalw.art/docs/server/listener/): `NetworkListener` with `protocol: smtp` and `bind` e.g. `[::]:25`. [Inbound session](https://stalw.art/docs/mta/inbound/): Connect → EHLO → AUTH → MAIL → RCPT → DATA. [DATA stage](https://stalw.art/docs/mta/inbound/data/): after `DATA`/`BDAT`, Sieve, milter, then MTA Hooks; then the message continues into Stalwart's queue/ingest.

[MTA Hooks](https://stalw.art/docs/mta/filter/mtahooks/): HTTP POST JSON at `connect`/`ehlo`/`mail`/`rcpt`/`data`. Request includes SMTP envelope (`from`/`to`) and a structured `message` (`headers`, `contents`, `size`). Actions: accept, discard, reject, quarantine. This can implement opt-in `550` at `rcpt`, but accepted mail is still Stalwart's to ingest. The hook is a filter, not a replacement mailbox.

License: AGPL-3.0 or Stalwart Enterprise License v2 ([README](https://github.com/stalwartlabs/stalwart)).

**Fit:** a complete hosted mailbox product. Inverse of the tracer (and of the protocol): we need SMTP-in that *does not* own the **mailbox**. Do not run Stalwart as the two-node tracer.

## Two-node tracer shape

Independent of which listener you pick, the honest topology is:

| Process | Listen | Domain (SMTP) | Role |
| --- | --- | --- | --- |
| **Node** A | `127.0.0.1:2525` | `node-a.test` | Opt-in check on `RCPT TO`; encrypt + DAL on `DATA` |
| **Node** B | `127.0.0.1:2526` | `node-b.test` | Same, separate opt-in set / server key stub |

Shared (not SMTP): fake registry (which **names** opted into which **node**), encryption stub (`DEK_public`), DAL stub (put blob → CID, append index).

Accept path:

1. Client (swaks) connects to A or B. No MX.
2. `MAIL FROM` accepted (`250`).
3. `RCPT TO:<name@that-node.test>`: local-part is a registry **name** *and* this **node** is opted in → `250`; else `550 No such user here`.
4. `DATA` … `.` → `250`. IMF bytes go to open-email **envelope** encrypt, pin, index.
5. Repeat against the other **node**. Same **mailbox** (same **name**) if both are opted in; unauthorized **node** never sees the blob.

That is the inbound flow in `IDEA.md`, minus public MX, Rspamd, and real chain/IPFS.

## Tracer recommendation

**Use a tiny custom SMTP listener for the two-node tracer.** Bind two ports, implement RFC 5321 receive (`220` / `EHLO` / `MAIL FROM` / `RCPT TO` / `DATA`), refuse with `550` when the **name** is not opted in on that **node**, and pass the IMF bytes from `DATA` into encryption/DAL.

Pick the library in the language of the tracer:

- Node: **smtp-server** (`listen` + `onRcptTo` + `onData`). Smallest documented "add an SMTP listener to the app" API. Add `Received:` yourself if you want RFC 5321 §4.4.
- Python: **aiosmtpd** `Controller` on 2525/2526; `handle_RCPT` / `handle_DATA`. Built for tests.
- Go: **go-smtp** RFC 5321 server.

**Haraka** is the next step, not the first: SMTP-only, explicitly not a mail store, `rcpt` + `queue` plugins map onto opt-in + DAL. Use it when the tracer should be two daemons with `smtp.ini` rather than two `listen()` calls.

**Do not** stand up Stalwart, maddy, or Postfix for this tracer. They either own a mailbox store (Stalwart ingest, maddy imapsql) or insert a full queue (Postfix smtpd → cleanup → queue → pipe). maddy/Stalwart inbound checks (MX/SPF/DKIM) also fight localhost injection unless disabled.

Inject with **swaks `--server 127.0.0.1 --port <node>`**; netcat only for a typed Appendix D session. Public MX is out of scope until a **node** has a domain on the internet.

## Sources

- [RFC 5321](https://www.rfc-editor.org/rfc/rfc5321.html) — SMTP (session, transaction, 550, MX lookup, Appendix D, Received, dot-stuffing).
- [RFC 5322](https://www.rfc-editor.org/rfc/rfc5322) — Internet Message Format (header section + body).
- [smtp-server](https://nodemailer.com/extras/smtp-server), [receiving email](https://nodemailer.com/guides/receiving-email), [GitHub README](https://github.com/nodemailer/smtp-server).
- [aiosmtpd handlers](https://aiosmtpd.aio-libs.org/en/stable/handlers.html), [controller](https://aiosmtpd.aio-libs.org/en/stable/controller.html).
- [go-smtp](https://github.com/emersion/go-smtp).
- Haraka: [getting started](https://haraka.github.io/getting_started/), [plugins](https://haraka.github.io/core/Plugins/), [core config](https://haraka.github.io/core/CoreConfig/), [transaction](https://haraka.github.io/core/Transaction/), [writing plugins](https://haraka.github.io/tutorials/tutorial/).
- maddy: [README](https://github.com/foxcpp/maddy), [maddy.conf](https://github.com/foxcpp/maddy/blob/master/maddy.conf), [SMTP endpoint](https://maddy.email/reference/endpoints/smtp/), [misc checks](https://maddy.email/reference/checks/misc/), [target.smtp](https://foxcpp.github.io/maddy/reference/targets/smtp/).
- Postfix: [smtpd(8)](https://www.postfix.org/smtpd.8.html), [pipe(8)](http://www.postfix.org/pipe.8.html), [FILTER_README](https://www.postfix.org/FILTER_README.html).
- Stalwart: [README](https://github.com/stalwartlabs/stalwart), [listeners](https://stalw.art/docs/server/listener/), [inbound](https://stalw.art/docs/mta/inbound/), [DATA](https://stalw.art/docs/mta/inbound/data/), [MTA Hooks](https://stalw.art/docs/mta/filter/mtahooks/).
- Swaks: [ref.txt](http://jetmore.net/john/code/swaks/latest/doc/ref.txt), [base.pod](https://github.com/jetmore/swaks/blob/develop/doc/base.pod).
