// Turns a failed route response into a sentence worth showing.
//
// Every route in this app answers a failure with `{ error: "..." }`, and those
// strings are already written for a person -- "That image couldn't be
// processed", "File exceeds 5 MB limit". Most call sites, though, threw the
// body away and showed a fixed fallback, so the specific reason the server
// gave was lost and the user got a generic message instead of the real one.
//
// This matters most for 429s. The rate limiters return the wait time and a
// message explaining it; without reading the body, hitting a limit looks
// identical to any other failure, and the brief's requirement that "users see
// a clear message when they hit a rate limit" quietly goes unmet.
//
// The fallback is what gets shown when the body is missing, unparseable, or
// carries no usable `error` -- so a call site always ends up with something,
// and never with `undefined` rendered into the page.

/** Anything longer than this is not a sentence written for a user. */
const MAX_SERVER_MESSAGE_LENGTH = 300;

export async function failureMessage(response: Response, fallback: string): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fallback;
  }

  const error = (body as { error?: unknown } | null)?.error;

  // Zod's `flatten()` output is an object, and a couple of routes send it
  // straight through. Rendering that gives the user "[object Object]", so
  // anything that isn't a plain string falls back.
  if (typeof error !== "string") return fallback;

  const trimmed = error.trim();
  if (!trimmed || trimmed.length > MAX_SERVER_MESSAGE_LENGTH) return fallback;

  return trimmed;
}
