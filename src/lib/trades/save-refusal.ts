// A save the server refused on purpose: the request arrived, and what it
// asked for can't stand (a share count below what was already sold, a number
// too large to store). Retrying it can never work, and only the user can fix
// it -- so it is a different thing from a failed save (offline, signed out, a
// server error), which autosave keeps retrying.
//
// **The bug this exists for (Alon, 2026-11-09: "it didn't save some changes,
// like selling part of my stocks or moving a stop loss").** The trade page
// treated a refusal like a network blip: it threw the server's reason away,
// showed a small "Save failed", kept the typed value on screen, and re-sent
// it forever. Worse, every later edit on the page rode in the same request as
// the refused value, so the server turned the whole batch down each time: a
// share count the server refused quietly took a stop-loss move down with it.
//
// The marker is explicit (`refused: true`) rather than inferred from the
// status code, because PATCH /api/trades/[id] also answers 400 when the
// database write fails -- and that one IS worth retrying.

export interface SaveRefusal {
  /** Why, in words for the user. */
  message: string;
  /**
   * The core fields the refusal is about. Empty when the server can't say,
   * and then every field in the request is treated as refused.
   */
  fields: string[];
}

/** The JSON a route answers a refusal with. `error` stays for older clients. */
export function refusalBody(message: string, fields: string[] = [], error: unknown = message) {
  return { error, refused: true as const, message, fields };
}

/** The refusal in a response body, or null when the response isn't one. */
export function readRefusal(body: unknown): SaveRefusal | null {
  if (typeof body !== "object" || body === null) return null;
  const { refused, message, fields } = body as { refused?: unknown; message?: unknown; fields?: unknown };
  if (refused !== true || typeof message !== "string" || message.trim() === "") return null;
  return {
    message,
    fields: Array.isArray(fields) ? fields.filter((f): f is string => typeof f === "string") : [],
  };
}

/**
 * Which of the fields that were set aside to name on screen. The whole
 * request is set aside, not only the fields the server named: the others in
 * it were worked out from the refused value (typing a share count also sends
 * the dollar amount and risk), and saving them alone would store figures for
 * a share count that was never saved. But "Shares wasn't saved" is the useful
 * thing to say, so the server's fields are named when the request had them,
 * and everything set aside is named otherwise.
 */
export function refusedFieldNames(setAside: string[], refusal: SaveRefusal): string[] {
  const named = refusal.fields.filter((key) => setAside.includes(key));
  return named.length > 0 ? named : setAside;
}

/** "stop_loss" -> "Stop loss", for naming a field on screen. */
export function fieldLabel(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "Shares: number is too large to store accurately", from a zod error. */
export function firstIssueMessage(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const first = issues[0];
  if (!first) return "That value isn't valid.";
  const where = first.path.map(String).join(" ").replace(/_/g, " ").trim();
  const label = where ? where.charAt(0).toUpperCase() + where.slice(1) : "";
  return label ? `${label}: ${first.message}` : first.message;
}
