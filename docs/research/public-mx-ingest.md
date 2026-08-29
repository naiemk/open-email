# Public MX ingest for a real node

Ticket: [#22](https://github.com/naiemk/open-email/issues/22).
Question: what must a single **node** have so Gmail (and other SMTPs) will deliver to `name@that-domain`, and so the **node** can return 550 when the **name** is unknown or this **node** is not **opted in**?

This note covers DNS (MX / A / AAAA), STARTTLS, inbound vs outbound SPF/DKIM/DMARC, IPv6, TLS identity, and reject/defer codes. It cites primary sources only (RFCs, IANA, Google Postmaster / Workspace / Gmail SMTP docs). It does not pick a host, an MTA, or a TLS CA. It does not repeat the localhost-tracer decision in [smtp-ingest.md](smtp-ingest.md) (that file assumed a client already had an IP and port).

## Terms

From `CONTEXT.md` / `IDEA.md`:

- **Node**: an email-provider instance (domain, SMTP, own UI, registered server key). It may receive for a **name** only while that user is **opted in**.
- **Name**: the registry id. The SMTP address is `name@node-domain`.
- **Opt-in**: on-chain authorization of a **node**'s server key for a **mailbox**. Unauthorized **node**: SMTP 550, no receive.
- SMTP **envelope** (`MAIL FROM` / `RCPT TO`) is RFC 5321 routing, not the open-email encryption **envelope**.

Inbound flow in `IDEA.md`: MX of an **opted-in** **node** receives `name@that-node.com`. If the local-part is not a registry **name**, or this **node** is not opted in → user does not exist.

## What Gmail looks up (not what it authenticates)

Google's own MX setup text is the lookup, not a product recipe: "When someone sends you an email, the sender's computer looks up the MX records for your email domain … to figure out where to deliver it" ([Google Workspace: Set up MX records](https://support.google.com/a/answer/140038)).

That lookup is [RFC 5321 §5.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-5.1):

1. Resolve the domain on the right of `@` as an FQDN.
2. Look up MX. If a CNAME is found, follow it and start again. NXDOMAIN is a permanent error. A temporary DNS error MUST be queued and retried ([RFC 5321 §5.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-5.1), [§4.5.4.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-4.5.4.1)).
3. **Empty MX list** (domain exists, no MX): treat as an implicit MX preference 0 pointing at that host, then look up A/AAAA of the domain itself ([RFC 5321 §5.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-5.1); restated in [RFC 7505](https://www.rfc-editor.org/rfc/rfc7505.html)).
4. **One or more MX RRs present**: MUST NOT use A/AAAA of the *mail domain* except via those MX targets. If every MX is unusable, that is an error — there is no A/AAAA fallback ([RFC 5321 §5.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-5.1)).
5. Each MX target "MUST return at least one address record (e.g., A or AAAA RR)". An MX target that is a CNAME is outside the Standard ([RFC 5321 §5.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-5.1); [RFC 2181 §10.3](https://www.rfc-editor.org/rfc/rfc2181.html#section-10.3): the MX exchange "must not be an alias" and "must have as its value one or more address records").
6. Sort MX by preference (lower number first). Try addresses until one delivery attempt succeeds; SHOULD try at least two ([RFC 5321 §5.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-5.1)).

A **node** that intends to receive therefore needs:

- a public domain that exists in DNS;
- either MX RRs whose targets have A and/or AAAA, **or** (if it publishes no MX) A/AAAA on the domain itself;
- an SMTP listener on TCP port 25 of those addresses — the definition of a "publicly-referenced SMTP server" in [RFC 3207 §4](https://www.rfc-editor.org/rfc/rfc3207.html#section-4) is "an SMTP server which runs on port 25 of an Internet host listed in the MX record (or A record if an MX record is not present)".

Publishing MX is the recommended inbound advertisement even though implicit MX is legal ([RFC 8314 §4.5.1](https://www.rfc-editor.org/rfc/rfc8314.html#section-4.5.1): "It is recommended that MSPs advertise MX records for the handling of inbound mail (instead of relying entirely on A or AAAA records)").

**Null MX is the opposite of ingest.** A single MX with preference 0 and exchange `.` means the domain accepts no mail. Senders SHOULD then fail immediately with **556** / **5.1.10**, not connect ([RFC 7505](https://www.rfc-editor.org/rfc/rfc7505.html); [IANA X.1.10](https://www.iana.org/assignments/smtp-enhanced-status-codes/smtp-enhanced-status-codes.xhtml)). A receiving **node** must not publish null MX for `node-domain`.

## IPv6

[RFC 5321 §5.2](https://www.rfc-editor.org/rfc/rfc5321.html#section-5.2): MX targets may have A (IPv4), AAAA (IPv6), or both. "An IPv6-only client need not attempt to look up A RRs or attempt to reach IPv4-only servers." The dual is also true: an IPv4-only sender cannot connect to an IPv6-only MX.

Constraint: an AAAA-only MX host is unreachable from IPv4-only SMTPs (still common). An A-only MX host is unreachable from IPv6-only senders. Interop with "Gmail and other SMTPs" therefore needs at least one reachable IPv4 address on some MX, unless the operator accepts losing IPv4 senders.

PTR / reverse DNS is **not** part of RFC 5321 address resolution for *inbound* delivery. Google's PTR rule is a **sending** check when mail is delivered *to Gmail*: "The public IP address of a sending SMTP server must have a corresponding PTR record that resolves to a hostname" and that hostname's A/AAAA must match the sending IP ([Gmail Email sender guidelines](https://support.google.com/mail/answer/81126)). Missing PTR on a **node**'s inbound IP does not, in those docs, stop Gmail from *delivering to* the **node**. Missing PTR on a **node**'s *outbound* IP does stop or rate-limit mail *to* Gmail (`451 4.7.23` / `550 5.7.25`; IPv6: `550 5.7.1` "does not meet IPv6 sending guidelines regarding PTR records and authentication") ([Gmail SMTP errors and codes](https://support.google.com/mail/answer/3726730)).

## STARTTLS is the MX hop's TLS, and it is not optional flavor

Inbound MX TLS is [RFC 3207](https://www.rfc-editor.org/rfc/rfc3207.html) STARTTLS on port 25. After `EHLO`, the server may advertise `STARTTLS`; the client issues `STARTTLS`; 220 starts TLS; 454 means TLS is temporarily unavailable; after handshake the SMTP state is reset and the client SHOULD `EHLO` again ([RFC 3207 §4](https://www.rfc-editor.org/rfc/rfc3207.html#section-4)).

Two constraints pull opposite ways:

1. **A public MX MUST still accept mail without requiring STARTTLS.** "A publicly-referenced SMTP server MUST NOT require use of the STARTTLS extension in order to deliver mail locally. This rule prevents the STARTTLS extension from damaging the interoperability of the Internet's SMTP infrastructure" ([RFC 3207 §4](https://www.rfc-editor.org/rfc/rfc3207.html#section-4)). Requiring `530 Must issue a STARTTLS command first` is for servers that are *not* publicly referenced (e.g. submission). A **node** that 530s every Gmail connection that skipped STARTTLS is outside that MUST NOT.
2. **Many senders will only deliver over TLS, or will prefer it.** Gmail "always tries to send messages over a secure TLS connection. … If the receiving server doesn't use TLS, Gmail still sends messages but the connection isn't secure" ([Google Workspace: Send email over a secure TLS connection](https://support.google.com/a/answer/2520500)). That is opportunistic TLS: advertise STARTTLS or Gmail may still deliver in the clear. A Workspace admin *can* turn on Secure transport (TLS) compliance for named destinations; then "Outgoing messages … aren't delivered, and will bounce" if TLS is missing, and options include "Require CA signed certificate" and "Validate certificate hostname" ([same page](https://support.google.com/a/answer/2520500)). Senders that honor [MTA-STS](https://www.rfc-editor.org/rfc/rfc8461.html) in `enforce` mode "MUST NOT deliver the message to hosts that fail MX matching or certificate validation or that do not support STARTTLS" ([RFC 8461 §5](https://www.rfc-editor.org/rfc/rfc8461.html#section-5)). [DANE SMTP](https://www.rfc-editor.org/rfc/rfc7672.html) likewise: a DNSSEC-validated TLSA set is a commitment to TLS; the client MUST NOT deliver via that host without STARTTLS.

[RFC 8314](https://www.rfc-editor.org/rfc/rfc8314.html) tightens TLS for *submission and access*; inbound MX handling is explicitly "out of scope" there ([§4.5.1](https://www.rfc-editor.org/rfc/rfc8314.html#section-4.5.1)). Port 465 implicit TLS is not how public MX ingest works.

**Constraint for a public node:** listen on 25; advertise STARTTLS and complete a handshake that modern senders will accept; do not make STARTTLS a precondition for all local delivery if the goal is RFC 3207 interop with every SMTP. Senders that *require* TLS (MTA-STS enforce, DANE TLSA, Workspace TLS compliance) will not complete delivery unless STARTTLS + a matching cert succeed.

Gmail as *recipient* (mail **to** @gmail.com) is the other direction: since Dec 2023 / Feb 2024, senders to personal Gmail must "Use a TLS connection for transmitting email" ([Email sender guidelines](https://support.google.com/mail/answer/81126); errors `421 4.7.29` / `550 5.7.29` in [Gmail SMTP errors](https://support.google.com/mail/answer/3726730)). That is outbound from a **node**, not inbound MX ingest.

## TLS certificate: MX hostname, not the mail domain

[RFC 7817](https://www.rfc-editor.org/rfc/rfc7817.html) (SNI / DNS-ID rules for SMTP *Submission*, IMAP, POP) "doesn't apply to use of TLS in MTA-to-MTA SMTP." MTA-to-MTA identity is specified by MTA-STS and DANE:

- MTA-STS: the receiving MTA's certificate "MUST have a subject alternative name (SAN) with a DNS-ID matching the hostname" of the **MX host**, per RFC 6125 ([RFC 8461 §4.2](https://www.rfc-editor.org/rfc/rfc8461.html#section-4.2)). The policy's `mx:` patterns match MX **record names**, not the recipient domain ([§4.1](https://www.rfc-editor.org/rfc/rfc8461.html#section-4.1)).
- DANE: TLSA is queried at `_25._tcp.<MX-hostname>` ([RFC 7672](https://www.rfc-editor.org/rfc/rfc7672.html)).
- Google Workspace TLS test failures: "If your mail server has more than one hostname, make sure you're using the hostname that's on the server's certificate" ([TLS help](https://support.google.com/a/answer/2520500)).

If `example.com` MX 10 `mail.example.net`, the cert SAN is `mail.example.net` (or a matching wildcard), not necessarily `example.com`.

**SNI:** clients that do MTA-STS "MUST" send SNI containing the **MX hostname** ([RFC 8461 §7.1](https://www.rfc-editor.org/rfc/rfc8461.html#section-7.1)). DANE clients MUST send SNI containing the TLSA base domain ([RFC 7672 §8.1](https://www.rfc-editor.org/rfc/rfc7672.html)). Servers MAY use SNI to pick a cert chain. Servers **MUST NOT** refuse clients that omit SNI: send a fallback chain ([RFC 8461 §7.1](https://www.rfc-editor.org/rfc/rfc8461.html#section-7.1); [RFC 7672 §8.1](https://www.rfc-editor.org/rfc/rfc7672.html)). A **node** that only serves one identity does not need to *require* SNI; a **node** that hosts many names on one IP needs SNI *and* a default cert.

MTA-STS also requires TLS 1.2 or newer ([RFC 8461 §7.2](https://www.rfc-editor.org/rfc/rfc8461.html#section-7.2)). Google Workspace documents support for TLS 1.0–1.3 on *their* side ([TLS help](https://support.google.com/a/answer/2520500)); that is not a license for a **node** to offer only TLS 1.0.

## Inbound vs outbound: SPF / DKIM / DMARC / PTR / Postmaster

These mechanisms authenticate or reputation-score the **sender**. They are not how Gmail finds a **node**, and they are not a documented Google requirement for Gmail to *deliver inbound* to a random domain's MX.

| Mechanism | What it is | Required for Gmail → node? | Required for node → Gmail? |
| --- | --- | --- | --- |
| MX / A / AAAA | Where to connect ([RFC 5321 §5.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-5.1)) | Yes | No (Gmail's MX is the destination) |
| STARTTLS on 25 | Hop encryption ([RFC 3207](https://www.rfc-editor.org/rfc/rfc3207.html)) | Advertise; do not RFC-require for local delivery. Some senders will refuse without it. | Yes, to personal Gmail ([sender guidelines](https://support.google.com/mail/answer/81126)) |
| SPF | Authorizes hosts to use a domain in `MAIL FROM` / HELO ([RFC 7208](https://www.rfc-editor.org/rfc/rfc7208.html) abstract) | No. The **node** may *check* SPF on mail it receives; Gmail does not need the **node**'s SPF to deliver *to* it. | Yes (SPF or DKIM for all senders; SPF and DKIM for ≥5k/day) ([sender guidelines](https://support.google.com/mail/answer/81126)) |
| DKIM | Signing domain claims responsibility for a message ([RFC 6376](https://www.rfc-editor.org/rfc/rfc6376.html) abstract) | No for inbound reachability. | Same as SPF row; DKIM key ≥1024 bits to Gmail ([sender guidelines](https://support.google.com/mail/answer/81126)) |
| DMARC | Originator policy for mail that fails SPF/DKIM alignment ([RFC 7489](https://www.rfc-editor.org/rfc/rfc7489.html) abstract) | No for inbound reachability. A **node** may *enforce* others' DMARC on mail it accepts. | Required for bulk senders to Gmail; policy may be `none` ([sender guidelines](https://support.google.com/mail/answer/81126)) |
| PTR (reverse DNS) | Sending-IP identity ([sender guidelines](https://support.google.com/mail/answer/81126)) | Not stated as an inbound-MX requirement. | Yes, on the **sending** IP (IPv4 and IPv6) |
| Postmaster Tools | Dashboards for "**outgoing** email you send to personal Gmail accounts" ([Postmaster Tools dashboards](https://support.google.com/mail/answer/14668346)) | No. Encryption/auth dashboards there measure mail *to* Gmail. | Operational for sending, not ingest |

A **node** that later sends `From: name@node-domain` is a *sender* and then needs SPF/DKIM/(DMARC), PTR, and TLS outbound. That is a different ticket than public MX ingest. v1 outbound relay in `IDEA.md` does not change the inbound DNS/TLS constraints above.

A **node** MAY still run inbound SPF/DKIM/DMARC as spam policy on mail it has already been selected to receive. Those checks happen after Gmail has connected to the MX. They do not replace MX or STARTTLS.

## 550 vs 450 / 451: user-unknown vs defer

[RFC 5321 §4.2.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-4.2.1): first digit decides retry.

- **4yz** transient: "the SMTP client SHOULD try again." Same command, later, may succeed.
- **5yz** permanent: "The SMTP client SHOULD NOT repeat the exact request."

Google Workspace restates this: codes starting with 4 are temporary ("the sender will try again"); codes starting with 5 are permanent ("action is required") ([About SMTP error messages](https://support.google.com/a/answer/3221692)).

### Permanent: name unknown or not opted in

On `RCPT TO`, if the recipient "is known not to be a deliverable address, the SMTP server returns a 550 reply, typically with a string such as `no such user - ` and the mailbox name" ([RFC 5321 §3.3](https://www.rfc-editor.org/rfc/rfc5321.html#section-3.3)). Sample: `550 No such user here` ([RFC 5321 Appendix D.1](https://www.rfc-editor.org/rfc/rfc5321.html#appendix-D.1)).

[RFC 5321 §4.2.2](https://www.rfc-editor.org/rfc/rfc5321.html#section-4.2.2) defines **550** as "mailbox unavailable (e.g., mailbox not found, no access, or command rejected for policy reasons)". Unknown **name** and "this **node** is not opted in" both fit 550 (not found / no access / policy).

Enhanced status for "the address portion to the left of the `@` is invalid": **X.1.1** "Bad destination mailbox address", associated basic codes 451 and 550, "only useful for permanent failures" ([RFC 3463](https://www.rfc-editor.org/rfc/rfc3463.html); [IANA SMTP Enhanced Status Codes](https://www.iana.org/assignments/smtp-enhanced-status-codes/smtp-enhanced-status-codes.xhtml)). Gmail's own text for that pair: `550 5.1.1 The email account that you tried to reach does not exist. Please double-check the recipient's email address…` ([Gmail SMTP errors](https://support.google.com/mail/answer/3726730)).

Concrete language that maps to "does not exist" rather than greylist:

- `550 5.1.1 No such user here`
- `550 5.1.1 User unknown`
- Gmail-shaped: `550 5.1.1 The email account that you tried to reach does not exist`

Do this on **RCPT TO**, before `DATA`. Accepting DATA then bouncing with 550 after the fact "makes it difficult or impossible for the client to determine which recipients failed" ([RFC 5321 §3.3](https://www.rfc-editor.org/rfc/rfc5321.html#section-3.3)). After `250` on DATA, the receiver has accepted responsibility ([RFC 5321 §6.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-6.1)).

Do **not** use these if the intent is "user does not exist":

- **5.7.1** "Delivery not authorized, message refused" — policy/spam, not missing local-part ([IANA X.7.1](https://www.iana.org/assignments/smtp-enhanced-status-codes/smtp-enhanced-status-codes.xhtml)). Gmail uses `550 5.7.1` for policy, spam, IPv6 sending guidelines, missing From, etc. ([Gmail SMTP errors](https://support.google.com/mail/answer/3726730)).
- **5.1.2** bad *domain* (right of `@`) — Gmail: `553 5.1.2 We weren't able to find the recipient domain` ([Gmail SMTP errors](https://support.google.com/mail/answer/3726730)).
- **5.2.1** mailbox exists but inactive/disabled ([IANA X.2.1](https://www.iana.org/assignments/smtp-enhanced-status-codes/smtp-enhanced-status-codes.xhtml); Gmail: "The email account that you tried to reach is inactive").
- **556 / 5.1.10** null MX (domain accepts no mail) ([RFC 7505](https://www.rfc-editor.org/rfc/rfc7505.html)).

[RFC 5321 §7.9](https://www.rfc-editor.org/rfc/rfc5321.html#section-7.9): when mail is rejected for policy, "a 550 code SHOULD be used in response to EHLO (or HELO), MAIL, or RCPT as appropriate."

### Transient: greylist / defer / retry

**450**: mailbox unavailable, e.g. "mailbox busy or temporarily blocked for policy reasons" ([RFC 5321 §4.2.2](https://www.rfc-editor.org/rfc/rfc5321.html#section-4.2.2)). Gmail uses `450 4.2.1` for rate limits ("resend your message at a later time") ([Gmail SMTP errors](https://support.google.com/mail/answer/3726730)).

**451**: "local error in processing" / "error in processing" ([RFC 5321 §4.2.2](https://www.rfc-editor.org/rfc/rfc5321.html#section-4.2.2)). Gmail: `451 4.3.0 Email server has temporarily rejected this message`; `451 4.4.2 Timeout`.

**421**: service not available, closing channel ([RFC 5321 §4.2.2](https://www.rfc-editor.org/rfc/rfc5321.html#section-4.2.2)). Gmail: `421 4.4.5 Server busy, try again later`; `421 4.7.0 TLS required for RCPT domain, closing connection` (Workspace TLS *inbound to Gmail*).

**452**: insufficient storage ([RFC 5321 §4.2.2](https://www.rfc-editor.org/rfc/rfc5321.html#section-4.2.2)).

A **node** that 450/451/421s an unknown **name** (greylist, "try later", "directory unavailable") will cause Gmail to **retry**, not bounce. That is the opposite of "user does not exist." Use 4yz only for conditions that can succeed later without the sender changing the address (RFC 5321 rule of thumb in [§4.2.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-4.2.1)). Opt-in lookup failure that is *temporary* (registry unreachable) is 451 / 4.4.3-class, not 550. Opt-in that is *known absent* is 550 5.1.1.

## Constraint list (not a design)

A single public **node** that Gmail can deliver to, and that can refuse unknown / not-opted-in **names**, is constrained as follows:

1. **DNS for `node-domain`:** MX RRs whose exchange names have A and/or AAAA (preferred), or no MX and A/AAAA on the domain (implicit MX). MX exchange MUST NOT be a CNAME. Do not publish null MX. ([RFC 5321 §5.1](https://www.rfc-editor.org/rfc/rfc5321.html#section-5.1), [RFC 2181 §10.3](https://www.rfc-editor.org/rfc/rfc2181.html#section-10.3), [RFC 7505](https://www.rfc-editor.org/rfc/rfc7505.html), [Google MX lookup description](https://support.google.com/a/answer/140038))
2. **IPv4 reachability** unless IPv4 senders are intentionally out of scope. AAAA-only MX does not receive from IPv4-only clients. ([RFC 5321 §5.2](https://www.rfc-editor.org/rfc/rfc5321.html#section-5.2))
3. **SMTP on port 25** at those addresses, greeting `220`, then RFC 5321 `EHLO` / `MAIL` / `RCPT` / `DATA`. ([RFC 3207 §4](https://www.rfc-editor.org/rfc/rfc3207.html#section-4), [RFC 5321 §3.3](https://www.rfc-editor.org/rfc/rfc5321.html#section-3.3))
4. **STARTTLS advertised** on that listener; handshake that presents a cert whose SAN DNS-ID matches the **MX hostname**. Do not require STARTTLS for *all* local delivery (RFC 3207 public-MX MUST NOT). Expect some senders (MTA-STS enforce, DANE, Workspace TLS compliance) to refuse if STARTTLS or hostname match fails. Servers MUST NOT require SNI; clients that authenticate will send the MX hostname as SNI. ([RFC 3207](https://www.rfc-editor.org/rfc/rfc3207.html), [RFC 8461](https://www.rfc-editor.org/rfc/rfc8461.html), [RFC 7672](https://www.rfc-editor.org/rfc/rfc7672.html), [Google TLS](https://support.google.com/a/answer/2520500))
5. **RCPT TO `name@node-domain`:** 250 only if the local-part is a registry **name** *and* this **node** is opted in; otherwise **`550 5.1.1`** with user-unknown text, before DATA. Not 450/451 (retry), not 5.7.1 (spam/policy), not 5.2.1 (disabled-but-exists). ([RFC 5321 §3.3](https://www.rfc-editor.org/rfc/rfc5321.html#section-3.3) / [D.1](https://www.rfc-editor.org/rfc/rfc5321.html#appendix-D.1), [RFC 3463 X.1.1](https://www.rfc-editor.org/rfc/rfc3463.html), [IANA](https://www.iana.org/assignments/smtp-enhanced-status-codes/smtp-enhanced-status-codes.xhtml), [Gmail 550 5.1.1](https://support.google.com/mail/answer/3726730))
6. **SPF, DKIM, DMARC, PTR, Postmaster Tools** are outbound (this **node** sending, especially to Gmail). They are not documented Google requirements for Gmail to *deliver to* the MX. PTR on the inbound IP is not the Gmail-inbound gate; PTR on the outbound IP is. ([RFC 7208](https://www.rfc-editor.org/rfc/rfc7208.html), [RFC 6376](https://www.rfc-editor.org/rfc/rfc6376.html), [RFC 7489](https://www.rfc-editor.org/rfc/rfc7489.html), [sender guidelines](https://support.google.com/mail/answer/81126), [Postmaster Tools](https://support.google.com/mail/answer/14668346))

This file does not choose the MX hostname, the address family mix, the MTA, or whether to publish MTA-STS / DANE. Those are product picks on top of these constraints.

## Sources

- [RFC 5321](https://www.rfc-editor.org/rfc/rfc5321.html) — SMTP: session, 4yz vs 5yz, 550/450/451, MX lookup, IPv6 MX, Appendix D `550 No such user here`, accept-after-DATA.
- [RFC 3207](https://www.rfc-editor.org/rfc/rfc3207.html) — STARTTLS; public MX MUST NOT require it for local delivery; port 25.
- [RFC 2181 §10.3](https://www.rfc-editor.org/rfc/rfc2181.html#section-10.3) — MX target must not be a CNAME; must have address records.
- [RFC 1035 §3.3.9](https://www.rfc-editor.org/rfc/rfc1035.html#section-3.3.9) — MX RR format (preference + exchange).
- [RFC 7505](https://www.rfc-editor.org/rfc/rfc7505.html) — Null MX; implicit A/AAAA fallback; 556 / 5.1.10.
- [RFC 3463](https://www.rfc-editor.org/rfc/rfc3463.html) — Enhanced status codes; X.1.1 vs X.2.x vs X.4.x vs X.7.x.
- [IANA SMTP Enhanced Status Codes](https://www.iana.org/assignments/smtp-enhanced-status-codes/smtp-enhanced-status-codes.xhtml) — X.1.1 associated with 451, 550.
- [RFC 7208](https://www.rfc-editor.org/rfc/rfc7208.html) — SPF authorizes sending hosts for MAIL FROM / HELO.
- [RFC 6376](https://www.rfc-editor.org/rfc/rfc6376.html) — DKIM signing domain claims responsibility.
- [RFC 7489](https://www.rfc-editor.org/rfc/rfc7489.html) — DMARC originator policy for unauthenticated mail.
- [RFC 8461](https://www.rfc-editor.org/rfc/rfc8461.html) — MTA-STS: cert matches MX hostname; SNI is MX hostname; enforce mode requires STARTTLS.
- [RFC 7672](https://www.rfc-editor.org/rfc/rfc7672.html) — DANE for SMTP: TLSA under MX hostname; SNI; MUST NOT require SNI.
- [RFC 7817](https://www.rfc-editor.org/rfc/rfc7817.html) — TLS identity for Submission/IMAP/POP; **not** MTA-to-MTA.
- [RFC 8314](https://www.rfc-editor.org/rfc/rfc8314.html) — TLS for submission/access; inbound MX out of scope; MX still recommended over A-only.
- [RFC 6066](https://www.rfc-editor.org/rfc/rfc6066.html) — TLS SNI extension (referenced by RFC 8461 / RFC 7672).
- [Google Workspace: Set up MX records](https://support.google.com/a/answer/140038) — senders look up MX for the recipient domain.
- [Google Workspace: Send email over a secure TLS connection](https://support.google.com/a/answer/2520500) — Gmail opportunistic TLS outbound; optional enforce + CA + hostname match.
- [Gmail Email sender guidelines](https://support.google.com/mail/answer/81126) — TLS, SPF/DKIM/DMARC, PTR for mail **to** Gmail.
- [Email sender guidelines FAQ](https://support.google.com/mail/answer/14229414) — 4.7.23 / 5.7.25 PTR, 4.7.29 / 5.7.29 TLS (sending to Gmail).
- [Gmail SMTP errors and codes](https://support.google.com/mail/answer/3726730) — `550 5.1.1` does not exist; 450/451/421 retry; 5.7.x policy.
- [Google Workspace: About SMTP error messages](https://support.google.com/a/answer/3221692) — 4 = retry, 5 = permanent.
- [Postmaster Tools dashboards](https://support.google.com/mail/answer/14668346) — outgoing mail **to** personal Gmail, not inbound MX.
