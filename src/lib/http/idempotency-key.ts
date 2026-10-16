// A fresh Idempotency-Key for one user action (a click, a submit), sent with
// requests that must not run twice. Reuse the same key when retrying that
// same action; make a new one for the next action. See idempotency.ts.
export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
