/** Always-on passkey flow tracing — filter DevTools console with `[passkey]`. */

let seq = 0;
const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

function elapsed(): string {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return `${Math.round(now - t0)}ms`;
}

function caller(): string | undefined {
  const line = new Error().stack?.split("\n")[3]?.trim();
  return line?.replace(/^at /, "");
}

export function passkeyLog(step: string, detail?: Record<string, unknown>): void {
  const id = ++seq;
  const payload = detail ?? {};
  const from = caller();
  if (from) Object.assign(payload, { from });
  console.log(`[passkey #${id} +${elapsed()}] ${step}`, payload);
}

export function passkeyLogError(step: string, err: unknown, detail?: Record<string, unknown>): void {
  const id = ++seq;
  const e = err instanceof Error ? err : new Error(String(err));
  const payload = {
    ...(detail ?? {}),
    errName: e.name,
    errMessage: e.message,
    from: caller(),
  };
  console.error(`[passkey #${id} +${elapsed()}] ${step}`, payload, e);
}
