/** Default trailing signature for new outbound messages (plain text in compose). */
export const COMPOSE_SIGNATURE_PLAIN =
  "\n\n\nSent with crypted.email secure mail.\nRe-imagining email with Open Email protocol.";

export function initialComposeBody(mode: "new" | "reply" | "replyAll" | "forward", quoted?: string): string {
  if (mode === "new") return COMPOSE_SIGNATURE_PLAIN;
  const sig = COMPOSE_SIGNATURE_PLAIN.trimStart();
  return quoted ? `\n\n${sig}\n\n${quoted}` : `\n\n${sig}`;
}
