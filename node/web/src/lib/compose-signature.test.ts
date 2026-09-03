import { describe, expect, it } from "vitest";
import { COMPOSE_SIGNATURE_PLAIN, initialComposeBody } from "./compose-signature.ts";

describe("compose signature", () => {
  it("includes default signature for new messages", () => {
    expect(initialComposeBody("new")).toBe(COMPOSE_SIGNATURE_PLAIN);
    expect(COMPOSE_SIGNATURE_PLAIN).toContain("crypted.email");
  });

  it("appends signature before quoted reply text", () => {
    const body = initialComposeBody("reply", "> prior text");
    expect(body).toContain("crypted.email");
    expect(body).toContain("> prior text");
  });
});
