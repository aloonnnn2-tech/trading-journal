import { scrubString } from "./scrub";

// The server's one logger: one JSON line per event, with a level, the
// request's id (set by src/proxy.ts as x-request-id, so one failing request
// can be followed through every line it wrote), and everything redacted on
// the way out. Netlify keeps function logs; Sentry turns them into
// breadcrumbs. Neither should ever hold a key, a token, an email address or
// what someone wrote in their journal.
//
//   log.error("images.upload_failed", { tradeId, error });
//
// Use it instead of console.* in server code.

export type LogLevel = "info" | "warn" | "error";

/** Fields whose value is a credential, whatever it looks like. */
const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|encrypted|credential/i;
/** Fields holding what a person wrote or uploaded: never logged, only counted. */
const CONTENT_KEY = /^(notes?|body|content|text|custom_fields|strategy_field_values|rows|raw|prompt|answer|reply|message_text|email|company_name|details|hint)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function cleanString(value: string): string {
  return scrubString(value).replace(EMAIL, "[email]");
}

/** A value made safe to log: credentials, emails and journal content removed. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return cleanString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    return { name: value.name, message: cleanString(value.message), ...(code !== undefined ? { code } : {}) };
  }
  if (depth >= 4) return "[nested]";
  if (Array.isArray(value)) {
    return value.length > 20
      ? [...value.slice(0, 20).map((v) => redact(v, depth + 1)), `[+${value.length - 20} more]`]
      : value.map((v) => redact(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) out[key] = "[redacted]";
      else if (CONTENT_KEY.test(key)) out[key] = v == null ? v : "[content]";
      else out[key] = redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function formatLogLine(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
  requestId: string | null = null,
  now: Date = new Date(),
): string {
  return JSON.stringify({
    level,
    time: now.toISOString(),
    event,
    ...(requestId ? { requestId } : {}),
    ...(redact(fields) as Record<string, unknown>),
  });
}

/**
 * The current request's id, when there is a request. next/headers only
 * works inside one; anywhere else (a worker starting up) there is no id.
 */
export async function currentRequestId(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()).get("x-request-id");
  } catch {
    return null;
  }
}

function write(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
  void currentRequestId().then((requestId) => {
    const line = formatLogLine(level, event, fields, requestId);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
  });
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
