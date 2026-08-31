/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { generateDek, unwrapDek, wrapDek } from "../../client/src/dek.ts";
import { openEnvelope } from "../../client/src/envelope.ts";
import { p256CoordsFromPublicKey, webAuthnUserError } from "../../client/src/webauthn-p256.ts";
import { applyField, isFormControlTag, isValidOeId, mailboxPreview } from "./ui-fields.ts";

const PRF_SALT = new Uint8Array(32);
new TextEncoder().encode("open-email/prf-kek/v1").forEach((b, i) => {
  PRF_SALT[i] = b;
});

type Folder = "inbox" | "sent" | "trash";
type IndexRow = {
  seq: number;
  cid: string;
  direction: "in" | "out";
  trashed: boolean;
  time: number;
};
type Mail = IndexRow & { from: string; subject: string; body: string };

type State = {
  domain: string;
  nodeKey: Hex;
  screen: "signup" | "mail" | "settings";
  folder: Folder;
  composing: boolean;
  composeTo: string;
  composeSubject: string;
  composeBody: string;
  query: string;
  selected: number | null;
  mails: Mail[];
  storage: { total_size: number; cap: number; warn: boolean };
  optedIn: boolean;
  name: string;
  dekPrivate: Uint8Array | null;
  error: string;
  busy: boolean;
  fakeCheckout: boolean;
  turnstileSiteKey: string;
  turnstileToken: string;
  signup: {
    oeId: string;
    credentialId: string;
    qx: Hex;
    qy: Hex;
    kek: Uint8Array | null;
    invoiceId: string;
    payLink: string;
    status: string;
    recovery: string;
  };
};

const state: State = {
  domain: "",
  nodeKey: "0x",
  screen: "signup",
  folder: "inbox",
  composing: false,
  composeTo: "",
  composeSubject: "",
  composeBody: "",
  query: "",
  selected: null,
  mails: [],
  storage: { total_size: 0, cap: 5 * 1024 * 1024, warn: false },
  optedIn: false,
  name: "",
  dekPrivate: null,
  error: "",
  busy: false,
  fakeCheckout: false,
  turnstileSiteKey: "",
  turnstileToken: "",
  signup: {
    oeId: "",
    credentialId: "",
    qx: "0x",
    qy: "0x",
    kek: null,
    invoiceId: "",
    payLink: "",
    status: "",
    recovery: "",
  },
};

const app = document.querySelector("#app");
if (app) {
  void boot();
  app.addEventListener("click", onClick);
  app.addEventListener("input", onInput);
  app.addEventListener("change", onInput);
  app.addEventListener("keydown", (e) => {
    if (e instanceof KeyboardEvent && e.key === "Enter" && (e.target as HTMLElement).dataset?.act === "query") {
      render();
    }
  });
}

async function boot(): Promise<void> {
  const typed = document.querySelector("[data-act=oeId]");
  if (typed instanceof HTMLInputElement && typed.value) state.signup.oeId = typed.value;
  render();
  try {
    const meta = (await (await fetch("/meta")).json()) as {
      domain: string;
      nodeKey: Hex;
      fakeCheckout?: boolean;
      turnstileSiteKey?: string;
    };
    state.domain = meta.domain;
    state.nodeKey = meta.nodeKey;
    state.fakeCheckout = Boolean(meta.fakeCheckout);
    state.turnstileSiteKey = meta.turnstileSiteKey ?? "";
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
  render();
}

function onInput(e: Event): void {
  const t = e.target as HTMLElement;
  if (!(t instanceof HTMLInputElement) && !(t instanceof HTMLTextAreaElement)) return;
  applyField(state, t.dataset.act, t.value);
  if (t.dataset.act === "oeId") {
    const preview = app?.querySelector("[data-mailbox-preview]");
    if (preview) preview.textContent = mailboxPreview(state.signup.oeId, state.domain);
  }
  if (t.dataset.act === "query" && e.type === "change") render();
}

function onClick(e: Event): void {
  if (isFormControlTag((e.target as HTMLElement).tagName)) return;
  const el = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
  if (!el) return;
  const act = el.dataset.act;
  const usesPasskey =
    act === "create-passkey" ||
    act === "unlock" ||
    act === "register" ||
    act === "saved" ||
    act === "opt-out" ||
    act === "opt-in";
  if (usesPasskey && state.busy) return;
  void (async () => {
    if (usesPasskey) {
      state.busy = true;
      render();
    }
    try {
      if (act === "folder") {
        state.folder = el.dataset.folder as Folder;
        state.screen = "mail";
        state.selected = visible()[0]?.seq ?? null;
      }
      if (act === "select") state.selected = Number(el.dataset.seq);
      if (act === "compose") state.composing = true;
      if (act === "close-compose") state.composing = false;
      if (act === "send") await sendMail();
      if (act === "settings") {
        state.screen = "settings";
        state.composing = false;
      }
      if (act === "mail") state.screen = "mail";
      if (act === "signup") state.screen = "signup";
      if (act === "create-passkey") await createPasskey();
      if (act === "invoice") await createInvoice();
      if (act === "register") await registerPaid();
      if (act === "saved") await confirmSaved();
      if (act === "unlock") await unlock();
      if (act === "trash") await moveTrash();
      if (act === "empty-trash") await emptyTrash();
      if (act === "load-more") await loadMore();
      if (act === "opt-out") await optOut();
      if (act === "opt-in") await optInExisting();
      state.error = "";
    } catch (err) {
      state.error = webAuthnUserError(err);
    } finally {
      state.busy = false;
    }
    render();
  })();
}

async function createPasskey(): Promise<void> {
  const oeId = state.signup.oeId.trim();
  if (!isValidOeId(oeId)) throw new Error("OE id must be at least 5 characters and contain no dots");
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: state.domain, id: location.hostname },
      user: { id: userId, name: oeId, displayName: oeId },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      extensions: { prf: { eval: { first: PRF_SALT } } },
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey was not created");
  const att = cred.response as AuthenticatorAttestationResponse;
  let spki = new Uint8Array(0);
  try {
    spki = new Uint8Array(att.getPublicKey?.() ?? new ArrayBuffer(0));
  } catch {
    /* Safari may omit getPublicKey(); attestation COSE is enough. */
  }
  const { qx, qy } = p256CoordsFromPublicKey(spki, new Uint8Array(att.attestationObject));
  const kek = prfFrom(cred);
  state.signup.credentialId = bytesToHex(new Uint8Array(cred.rawId));
  state.signup.qx = qx;
  state.signup.qy = qy;
  state.signup.kek = kek;
}

async function createInvoice(): Promise<void> {
  if (!state.signup.credentialId) throw new Error("Create a passkey first");
  if (!state.fakeCheckout && !state.turnstileToken) throw new Error("Complete the Turnstile check");
  const res = await fetch("/signup/invoice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      credentialId: state.signup.credentialId,
      oeId: state.signup.oeId.trim(),
      turnstile: turnstileToken(),
    }),
  });
  const body = (await res.json()) as { error?: string; id: string; payLink: string; status: string };
  if (!res.ok) throw new Error(body.error ?? "invoice failed");
  state.signup.invoiceId = body.id;
  state.signup.payLink = body.payLink;
  state.signup.status = body.status;
  void pollInvoice();
}

async function pollInvoice(): Promise<void> {
  const id = state.signup.invoiceId;
  while (id && state.signup.status !== "paid") {
    await new Promise((r) => setTimeout(r, 1000));
    const polled = (await (await fetch(`/signup/invoice/${id}`)).json()) as { status: string };
    state.signup.status = polled.status;
    render();
  }
}

async function registerPaid(): Promise<void> {
  const kek = state.signup.kek;
  if (!kek) throw new Error("Create a passkey first");
  const dek = generateDek();
  const wrappedDek = bytesToHex(wrapDek(dek.privateKey, kek));
  const dekPublic = bytesToHex(dek.publicKey);
  const recoveryKek = crypto.getRandomValues(new Uint8Array(32));
  const recoveryWrap = wrapDek(dek.privateKey, recoveryKek);
  const name = `${state.signup.oeId.trim()}.testnet`;
  const challenge = await registerChallenge(name, dekPublic, wrappedDek);
  const auth = await assertWebAuthn(challenge);
  const res = await fetch("/signup/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      invoiceId: state.signup.invoiceId,
      credentialId: state.signup.credentialId,
      qx: state.signup.qx,
      qy: state.signup.qy,
      dekPublic,
      wrappedDek,
      auth,
    }),
  });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "register failed");
  state.signup.recovery = encodeRecovery(recoveryKek, recoveryWrap);
  state.name = name;
  state.dekPrivate = dek.privateKey;
}

async function confirmSaved(): Promise<void> {
  const challenge = await optInChallenge(state.name, state.nodeKey);
  const auth = await assertWebAuthn(challenge);
  const res = await fetch("/signup/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      invoiceId: state.signup.invoiceId,
      credentialId: state.signup.credentialId,
      auth,
    }),
  });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "confirm failed");
  state.signup.recovery = "";
  state.optedIn = true;
  state.screen = "mail";
  await loadMailbox();
}

async function unlock(): Promise<void> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      userVerification: "required",
      extensions: { prf: { eval: { first: PRF_SALT } } },
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Unlock cancelled");
  const kek = prfFrom(cred);
  const oeId = state.signup.oeId.trim();
  if (!isValidOeId(oeId)) throw new Error("OE id must be at least 5 characters and contain no dots");
  const name = location.hostname === "testnet.crypted.email" || state.domain === "testnet.crypted.email"
    ? `${oeId}.testnet`
    : oeId;
  const boot = (await (await fetch(`/bootstrap/${name}`)).json()) as { wrappedDek: Hex };
  state.name = name;
  state.dekPrivate = unwrapDek(hexToBytes(boot.wrappedDek), kek);
  state.screen = "mail";
  await loadMailbox();
}

async function loadMailbox(): Promise<void> {
  if (!state.name || !state.dekPrivate) return;
  const rows = (await (await fetch(`/index/${state.name}`)).json()) as IndexRow[];
  state.mails = await decryptRows(rows);
  const storage = (await (await fetch(`/storage/${state.name}`)).json()) as State["storage"];
  state.storage = storage;
  const opted = (await (await fetch(`/api/opted-in/${state.name}/${state.nodeKey}`)).json()) as { optedIn: boolean };
  state.optedIn = opted.optedIn;
  if (state.selected == null) state.selected = visible()[0]?.seq ?? null;
}

async function loadMore(): Promise<void> {
  const oldest = state.mails.reduce((min, m) => Math.min(min, m.seq), Number.POSITIVE_INFINITY);
  const rows = (await (await fetch(`/index/${state.name}?before=${oldest}`)).json()) as IndexRow[];
  const more = await decryptRows(rows);
  state.mails = [...state.mails, ...more];
}

async function decryptRows(rows: IndexRow[]): Promise<Mail[]> {
  const dek = state.dekPrivate;
  if (!dek) return [];
  const mails: Mail[] = [];
  for (const row of rows) {
    const blob = new Uint8Array(
      await (await fetch(`/blobs/${row.cid}?name=${encodeURIComponent(state.name)}`)).arrayBuffer(),
    );
    const raw = new TextDecoder().decode(await openEnvelope(dek, state.name, blob));
    mails.push({ ...row, ...parseRfc822(raw) });
  }
  return mails;
}

async function moveTrash(): Promise<void> {
  if (state.selected == null) return;
  await fetch(`/trash/${state.name}/${state.selected}`, { method: "POST" });
  await loadMailbox();
}

async function sendMail(): Promise<void> {
  if (!state.name) throw new Error("Unlock first");
  const res = await fetch("/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: state.name,
      to: state.composeTo.trim(),
      subject: state.composeSubject,
      body: state.composeBody,
      turnstile: turnstileToken(),
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `send ${res.status}`);
  }
  state.composing = false;
  state.composeTo = "";
  state.composeSubject = "";
  state.composeBody = "";
  state.folder = "sent";
  await loadMailbox();
}

async function emptyTrash(): Promise<void> {
  await fetch(`/empty-trash/${state.name}`, { method: "POST" });
  await loadMailbox();
}

async function optOut(): Promise<void> {
  const challenge = await optOutChallenge(state.name, state.nodeKey);
  const auth = await assertWebAuthn(challenge);
  const res = await fetch("/api/opt-out", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: state.name, nodeKey: state.nodeKey, auth }),
  });
  if (!res.ok) throw new Error("opt-out failed");
  state.optedIn = false;
}

async function optInExisting(): Promise<void> {
  const challenge = await optInChallenge(state.name, state.nodeKey);
  const auth = await assertWebAuthn(challenge);
  const res = await fetch("/api/opt-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: state.name, nodeKey: state.nodeKey, auth }),
  });
  if (!res.ok) throw new Error("opt-in failed");
  state.optedIn = true;
}

function visible(): Mail[] {
  const inFolder = state.mails.filter((m) => {
    if (state.folder === "inbox") return m.direction === "in" && !m.trashed;
    if (state.folder === "sent") return m.direction === "out" && !m.trashed;
    return m.trashed;
  });
  const q = state.query.trim().toLowerCase();
  if (!q) return inFolder;
  return inFolder.slice(0, 100).filter((m) => `${m.subject}\n${m.body}\n${m.from}`.toLowerCase().includes(q));
}

function render(): void {
  if (!app) return;
  const active = document.activeElement as HTMLElement | null;
  const act = active?.dataset?.act;
  const pos =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active.selectionStart : null;
  if (state.screen === "signup") {
    app.innerHTML = signupHtml();
    restoreFocus(act, pos);
    mountTurnstile();
    return;
  }
  if (state.screen === "settings") {
    app.innerHTML = settingsHtml();
    return;
  }
  const rows = visible();
  const selected = rows.find((m) => m.seq === state.selected) ?? rows[0];
  const used = state.storage.total_size;
  const cap = state.storage.cap;
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  app.innerHTML = `
    <div class="split">
      <nav>
        <h1>${esc(state.domain)}</h1>
        <button type="button" class="compose" data-act="compose">Compose</button>
        <button type="button" class="folder${state.folder === "inbox" ? " on" : ""}" data-act="folder" data-folder="inbox">Inbox</button>
        <button type="button" class="folder${state.folder === "sent" ? " on" : ""}" data-act="folder" data-folder="sent">Sent</button>
        <button type="button" class="folder${state.folder === "trash" ? " on" : ""}" data-act="folder" data-folder="trash">Trash</button>
        <button type="button" data-act="settings">Settings</button>
        <div class="meter${state.storage.warn ? " warn" : ""}">Storage ${used} / ${cap} bytes (${pct}%)<i style="width:${pct}%"></i></div>
      </nav>
      <div class="list">
        <div class="search"><input type="search" placeholder="Search this view (last 100)" data-act="query" value="${esc(state.query)}"></div>
        ${rows
          .map(
            (m) => `<div class="row${selected?.seq === m.seq ? " on" : ""}" data-act="select" data-seq="${m.seq}">
          <b>${esc(m.subject || "(no subject)")}</b><span>${esc(m.from)}</span>
        </div>`,
          )
          .join("") || `<div class="row">No messages in this view.</div>`}
        <div class="row"><button type="button" data-act="load-more">Load more</button></div>
        ${state.folder === "trash" ? `<div class="row"><button type="button" data-act="empty-trash">Empty Trash</button></div>` : ""}
      </div>
      <div class="read">${
        selected
          ? `<h2>${esc(selected.subject || "(no subject)")}</h2><p>${esc(selected.from)}</p><pre>${esc(selected.body)}</pre>
             ${state.folder !== "trash" ? `<p><button type="button" data-act="trash">Move to Trash</button></p>` : ""}`
          : "<p>Select a message.</p>"
      }</div>
      ${
        state.composing
          ? `<div class="composer">
        <div><b>New message</b> · from ${esc(smtpFrom())}</div>
        <label>To</label><input type="text" data-act="compose-to" value="${esc(state.composeTo)}">
        <label>Subject</label><input type="text" data-act="compose-subject" value="${esc(state.composeSubject)}">
        <textarea placeholder="Write…" data-act="compose-body">${esc(state.composeBody)}</textarea>
        ${turnstileSlot()}
        <div>
          <button type="button" data-act="send">Send</button>
          <button type="button" data-act="close-compose">Discard</button>
        </div>
      </div>`
          : ""
      }
    </div>`;
  restoreFocus(act, pos);
  mountTurnstile();
}

function signupHtml(): string {
  const s = state.signup;
  return `<div class="sheet">
    <h1>${esc(state.domain)}</h1>
    <p>Create a passkey, pick an OE id, pay, save the recovery secret once, then this node opts you in.</p>
    ${state.error ? `<p class="err">${esc(state.error)}</p>` : ""}
    <label for="oe-id">OE id</label>
    <div class="id-row">
      <input id="oe-id" type="text" data-act="oeId" value="${esc(s.oeId)}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="alice" ${s.credentialId ? "readonly" : ""}>
      <span class="suffix">@${esc(state.domain)}</span>
    </div>
    <p class="hint" data-mailbox-preview>${esc(mailboxPreview(s.oeId, state.domain))}</p>
    ${!s.payLink ? turnstileSlot() : ""}
    <p><button type="button" data-act="create-passkey"${s.credentialId || state.busy ? " disabled" : ""}>Create passkey</button>
       <button type="button" data-act="unlock"${state.busy ? " disabled" : ""}>Unlock existing</button></p>
    ${s.credentialId ? `<p>Passkey ready. <button type="button" data-act="invoice">Continue to invoice</button></p>` : ""}
    ${s.payLink ? `<p>Invoice ${esc(s.status)}. <a href="${esc(s.payLink)}" target="_blank" rel="noopener">Open checkout</a>, then register.</p>
      ${s.status === "paid" ? `<p><button type="button" data-act="register">Register</button></p>` : ""}` : ""}
    ${s.recovery ? `<p><b>Recovery secret</b> (once). Lose every device and this secret → the mailbox is gone.</p>
      <pre class="secret">${esc(s.recovery)}</pre>
      <p><button type="button" data-act="saved">I saved it</button></p>` : ""}
  </div>`;
}

function settingsHtml(): string {
  const used = state.storage.total_size;
  const cap = state.storage.cap;
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return `<div class="sheet">
    <h2>Settings</h2>
    ${state.error ? `<p class="err">${esc(state.error)}</p>` : ""}
    <p>Opted in to this node: <b>${state.optedIn ? "yes" : "no"}</b>
      ${state.optedIn ? `<button type="button" data-act="opt-out">Opt out</button>` : `<button type="button" data-act="opt-in">Opt in</button>`}
    </p>
    <p>Storage ${used} / ${cap} bytes (${pct}%). Warn at 80%.</p>
    <div class="meter${state.storage.warn ? " warn" : ""}"><i style="width:${pct}%"></i></div>
    <h3>Plans (decorative)</h3>
    <p>Free testnet · 5 MB · view only, does not charge.</p>
    <p style="opacity:0.45">Plus $4/mo · 5 GB · greyed</p>
    <p><button type="button" data-act="mail">Back to mail</button></p>
  </div>`;
}

function turnstileToken(): string {
  if (state.fakeCheckout) return "ok";
  if (!state.turnstileToken) throw new Error("Complete the Turnstile check");
  return state.turnstileToken;
}

function turnstileSlot(): string {
  if (state.fakeCheckout || !state.turnstileSiteKey) return "";
  return `<div id="turnstile"></div>`;
}

function restoreFocus(act: string | undefined, pos: number | null): void {
  if (!app || !act) return;
  const el = app.querySelector(`[data-act="${act}"]`);
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
  el.focus();
  if (pos != null) el.setSelectionRange(pos, pos);
}

function mountTurnstile(): void {
  const host = app?.querySelector("#turnstile");
  if (!(host instanceof HTMLElement) || state.fakeCheckout || !state.turnstileSiteKey) return;
  const api = (
    window as unknown as {
      turnstile?: { render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void }) => void };
    }
  ).turnstile;
  if (!api) {
    window.setTimeout(mountTurnstile, 200);
    return;
  }
  api.render(host, {
    sitekey: state.turnstileSiteKey,
    callback: (token) => {
      state.turnstileToken = token;
    },
  });
}

function smtpFrom(): string {
  const oeId = state.name.endsWith(".testnet") ? state.name.slice(0, -".testnet".length) : state.name;
  return `${oeId}@${state.domain}`;
}

function parseRfc822(raw: string): { from: string; subject: string; body: string } {
  const split = raw.includes("\r\n\r\n") ? "\r\n\r\n" : "\n\n";
  const i = raw.indexOf(split);
  const head = i === -1 ? raw : raw.slice(0, i);
  const body = i === -1 ? "" : raw.slice(i + split.length);
  const header = (name: string) => {
    const m = head.match(new RegExp(`^${name}:\\s*(.*)$`, "im"));
    return m?.[1]?.trim() ?? "";
  };
  return { from: header("From"), subject: header("Subject"), body };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

function encodeRecovery(kek: Uint8Array, wrap: Uint8Array): string {
  const packed = new Uint8Array(kek.length + wrap.length);
  packed.set(kek);
  packed.set(wrap, kek.length);
  let bin = "";
  packed.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return `oe-r1.${btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")}`;
}

function prfFrom(cred: PublicKeyCredential): Uint8Array {
  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  const first = ext.prf?.results?.first;
  if (!first) throw new Error("Passkey PRF is required");
  const kek = new Uint8Array(first);
  if (kek.length !== 32) throw new Error("PRF KEK must be 32 bytes");
  return kek;
}

async function registerChallenge(name: string, dekPublic: Hex, wrappedDek: Hex): Promise<Hex> {
  const res = await fetch(
    `/api/register-challenge?name=${encodeURIComponent(name)}&dekPublic=${dekPublic}&wrappedDek=${wrappedDek}`,
  );
  return ((await res.json()) as { challenge: Hex }).challenge;
}

async function optInChallenge(name: string, nodeKey: Hex): Promise<Hex> {
  const res = await fetch(`/api/opt-in-challenge?name=${encodeURIComponent(name)}&nodeKey=${nodeKey}`);
  return ((await res.json()) as { challenge: Hex }).challenge;
}

async function optOutChallenge(name: string, nodeKey: Hex): Promise<Hex> {
  const res = await fetch(`/api/opt-out-challenge?name=${encodeURIComponent(name)}&nodeKey=${nodeKey}`);
  return ((await res.json()) as { challenge: Hex }).challenge;
}

async function assertWebAuthn(challenge: Hex): Promise<{
  r: Hex;
  s: Hex;
  challengeIndex: number;
  typeIndex: number;
  authenticatorData: Hex;
  clientDataJSON: string;
}> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: toBufferSource(hexToBytes(challenge)),
      rpId: location.hostname,
      userVerification: "required",
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey assertion cancelled");
  const assertion = cred.response as AuthenticatorAssertionResponse;
  const clientDataJSON = new TextDecoder().decode(assertion.clientDataJSON);
  const { r, s } = parseEcdsaDer(new Uint8Array(assertion.signature));
  return {
    r: bytesToHex(r),
    s: bytesToHex(s),
    challengeIndex: clientDataJSON.indexOf('"challenge"'),
    typeIndex: clientDataJSON.indexOf('"type"'),
    authenticatorData: bytesToHex(new Uint8Array(assertion.authenticatorData)),
    clientDataJSON,
  };
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function parseEcdsaDer(sig: Uint8Array): { r: Uint8Array; s: Uint8Array } {
  let o = 2;
  if (sig[0] !== 0x30) throw new Error("bad assertion signature");
  if (sig[2] !== 0x02) throw new Error("bad assertion signature");
  const rLen = sig[3]!;
  const r = pad32(stripInt(sig.slice(4, 4 + rLen)));
  o = 4 + rLen;
  if (sig[o] !== 0x02) throw new Error("bad assertion signature");
  const sLen = sig[o + 1]!;
  const s = pad32(stripInt(sig.slice(o + 2, o + 2 + sLen)));
  return { r, s };
}

function stripInt(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i += 1;
  return bytes.slice(i);
}

function pad32(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}
