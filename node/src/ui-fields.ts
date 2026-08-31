export const MIN_OE_ID_LENGTH = 5;

export type UiFields = {
  query: string;
  composeTo: string;
  composeSubject: string;
  composeBody: string;
  signup: { oeId: string };
};

export function applyField(fields: UiFields, act: string | undefined, value: string): void {
  if (act === "oeId") fields.signup.oeId = value;
  if (act === "query") fields.query = value;
  if (act === "compose-to") fields.composeTo = value;
  if (act === "compose-subject") fields.composeSubject = value;
  if (act === "compose-body") fields.composeBody = value;
}

export function isFormControlTag(tag: string | undefined): boolean {
  const name = tag?.toUpperCase();
  return name === "INPUT" || name === "TEXTAREA";
}

export function isValidOeId(oeId: string): boolean {
  const id = oeId.trim();
  return id.length >= MIN_OE_ID_LENGTH && !id.includes(".");
}

export function mailboxPreview(oeId: string, domain: string): string {
  const id = oeId.trim();
  return `${id || "you"}@${domain}`;
}
