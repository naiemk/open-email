import { hexToBytes } from "viem";
import { unwrapDek } from "../../client/src/dek.ts";
import { openEnvelope } from "../../client/src/envelope.ts";

const nameInput = document.querySelector<HTMLInputElement>("#name");
const kekInput = document.querySelector<HTMLInputElement>("#kek");
const listEl = document.querySelector<HTMLUListElement>("#list");
const bodyEl = document.querySelector<HTMLPreElement>("#body");

document.querySelector("#unlock")?.addEventListener("click", () => {
  void unlock();
});

async function unlock(): Promise<void> {
  if (!nameInput || !kekInput || !listEl || !bodyEl) return;
  const name = nameInput.value.trim();
  const kek = hexToBytes(`0x${kekInput.value.replace(/^0x/, "")}`);
  const boot = (await (await fetch(`/bootstrap/${name}`)).json()) as { wrappedDek: `0x${string}` };
  const dekPrivate = unwrapDek(hexToBytes(boot.wrappedDek), kek);
  const rows = (await (await fetch(`/index/${name}`)).json()) as { cid: string; seq: number }[];
  listEl.replaceChildren();
  bodyEl.textContent = "";
  for (const row of rows) {
    const blob = new Uint8Array(await (await fetch(`/blobs/${row.cid}`)).arrayBuffer());
    const plaintext = new TextDecoder().decode(await openEnvelope(dekPrivate, name, blob));
    const item = document.createElement("li");
    item.textContent = `seq ${row.seq}`;
    item.addEventListener("click", () => {
      bodyEl.textContent = plaintext;
    });
    listEl.append(item);
    if (!bodyEl.textContent) bodyEl.textContent = plaintext;
  }
}
