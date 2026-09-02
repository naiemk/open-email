/** Linked ENS local-parts and registry names (`vitalik.eth`). */
export function isLinkedEnsName(name: string): boolean {
  return /^[a-z0-9-]+\.eth$/i.test(name);
}

/** SMTP address local-part → registry name for this node domain. */
export function mailboxName(domain: string, address: string): string | undefined {
  const at = address.lastIndexOf("@");
  const local = (at === -1 ? address : address.slice(0, at)).toLowerCase();
  const host = (at === -1 ? "" : address.slice(at + 1)).toLowerCase();
  if (host !== domain.toLowerCase()) return undefined;
  if (domain.toLowerCase() === "testnet.crypted.email") {
    if (isLinkedEnsName(local)) return local;
    if (local.includes(".")) return undefined;
    return `${local}.testnet`;
  }
  return local;
}
