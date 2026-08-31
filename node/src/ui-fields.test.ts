import { describe, expect, it } from "vitest";
import { applyField, isFormControlTag, isValidOeId } from "./ui-fields.ts";

describe("signup and compose field binding", () => {
  it("keeps a typed OE id so a later click does not wipe it", () => {
    const fields = {
      query: "",
      composeTo: "",
      composeSubject: "",
      composeBody: "",
      signup: { oeId: "" },
    };
    applyField(fields, "oeId", "alice");
    expect(fields.signup.oeId).toBe("alice");
  });

  it("does not treat typing in a field as a page action", () => {
    expect(isFormControlTag("INPUT")).toBe(true);
    expect(isFormControlTag("TEXTAREA")).toBe(true);
    expect(isFormControlTag("BUTTON")).toBe(false);
  });

  it("rejects a short or dotted OE id the same way signup does", () => {
    expect(isValidOeId("alice")).toBe(true);
    expect(isValidOeId("bob")).toBe(false);
    expect(isValidOeId("alice.eth")).toBe(false);
  });
});
