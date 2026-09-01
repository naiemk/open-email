/** When disabled, signup/send accept the dev token `"ok"` without calling Cloudflare. */
export function createTurnstileVerifier(secret: string, disabled: boolean): (token: string) => Promise<boolean> {
  return async (token) => {
    if (disabled) return token === "ok";
    return verifyTurnstile(secret, token);
  };
}

export async function verifyTurnstile(secret: string, token: string): Promise<boolean> {
  if (!secret || !token) return false;
  const body = new URLSearchParams({ secret, response: token });
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return false;
  const parsed = (await res.json()) as { success?: boolean };
  return parsed.success === true;
}
