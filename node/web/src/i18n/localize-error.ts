import type { MessageKey } from "./messages.ts";
import type { Messages } from "./messages.ts";
import { translate } from "./messages.ts";

/** Map thrown / API English strings to catalog keys. */
const ERROR_MAP: Record<string, MessageKey> = {
  "OE id must be at least 5 characters with no dots": "errors.invalidOeId",
  "Complete the Turnstile check": "errors.turnstileRequired",
  "Demo account not configured on this node": "errors.demoNotConfigured",
  "Passkey coordinates missing — remove this stored login and sign up again": "errors.passkeyCoordsMissing",
  "No signup in progress": "errors.noSignupInProgress",
  "Mailbox not registered yet — sign up first or check your OE id": "errors.mailboxNotRegistered",
  "Invite is missing node identity": "errors.inviteMissingNode",
  "Invite already used": "errors.inviteUsed",
  "You already issued a grant for this invite in this browser": "errors.grantAlreadyIssued",
  "Pairing session expired — start again": "errors.pairingExpired",
  "Grant name mismatch": "errors.grantNameMismatch",
  "Grant passkey mismatch": "errors.grantPasskeyMismatch",
  "No mailbox with that id on the registry": "errors.noMailbox",
  "Enter a valid recipient address": "errors.invalidRecipient",
  "payload too large": "errors.payloadTooLarge",
  "attachment too large": "errors.attachmentTooLarge",
  "staging full": "errors.stagingFull",
  "Passkey was not created": "errors.passkeyNotCreated",
  "Passkey cancelled": "errors.passkeyCancelled",
  "Wrong passkey selected": "errors.wrongPasskey",
  "Passkey assertion cancelled": "errors.passkeyAssertionCancelled",
  "Passkey returned invalid client data": "errors.passkeyInvalidData",
  "Passkey PRF is required — use a device that supports PRF or enable mock mode": "errors.passkeyPrfRequired",
  "Could not decrypt this message.": "errors.decryptFailed",
  "join failed": "errors.joinFailed",
  "unknown session": "errors.unknownSession",
  "finish failed": "errors.finishFailed",
  "Register challenge unavailable — is the relayer running?": "errors.registerChallengeUnavailable",
  "Opt-in challenge unavailable — is the relayer running?": "errors.optInChallengeUnavailable",
  "Link challenge unavailable": "errors.linkChallengeUnavailable",
  "Remove-controller challenge unavailable": "errors.removeControllerChallengeUnavailable",
  "Mock passkey not found — sign up or use Demo sign in": "errors.mockPasskeyNotFound",
  "No mock passkeys — sign up or click Demo sign in": "errors.noMockPasskeys",
  "Relayer is down — register needs open-email-api on the node network": "errors.relayerDown",
  "Passkey signature rejected on-chain — stored key data may be stale. Sign up again with a fresh passkey.":
    "errors.passkeyRejected",
};

export function localizeError(messages: Messages, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/relayer unreachable|fetch failed|ECONNREFUSED/i.test(msg)) {
    return translate(messages, "errors.relayerDown");
  }
  if (/InvalidPasskey/i.test(msg)) {
    return translate(messages, "errors.passkeyRejected");
  }
  const key = ERROR_MAP[msg];
  if (key) return translate(messages, key);
  if (/^Request failed \(\d+\)$/.test(msg)) {
    return translate(messages, "errors.requestFailed");
  }
  return msg;
}
