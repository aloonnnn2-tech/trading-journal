import { z } from "zod";
import { HELP_TOPICS, HONEYPOT_FIELD, MESSAGE_MAX, MESSAGE_MIN, NAME_MAX, type HelpTopic } from "./config";

// What POST /api/help accepts. Every field is bounded here and again by the
// table's checks (0075), so nothing the database would refuse gets as far
// as an insert.

// Control characters other than newline and tab: never part of a real
// message, and the classic way to make a log line or a CSV cell lie.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const clean = (s: string) => s.replace(CONTROL, "").trim();

const topicIds = HELP_TOPICS.map((t) => t.id) as [HelpTopic, ...HelpTopic[]];

const schema = z.object({
  email: z.string().transform(clean).pipe(z.string().min(3).max(254).pipe(z.email())),
  name: z
    .string()
    .max(500)
    .transform((s) => clean(s).replace(/\s+/g, " "))
    .pipe(z.string().max(NAME_MAX))
    .nullish()
    .transform((v) => (v ? v : null)),
  topic: z.enum(topicIds),
  message: z.string().max(MESSAGE_MAX * 2).transform(clean).pipe(z.string().min(MESSAGE_MIN).max(MESSAGE_MAX)),
  // A path on this site only, for context; anything else is dropped.
  page: z
    .string()
    .max(200)
    .nullish()
    .transform((v) => (v && /^\/(?!\/)[\w\-./?=&%]*$/.test(v) ? v : null)),
  captchaToken: z.string().min(1).max(4096).optional(),
});

export type HelpRequestInput = z.output<typeof schema>;

export type ParsedHelpRequest =
  | { kind: "store"; data: HelpRequestInput }
  | { kind: "honeypot" }
  | { kind: "invalid"; message: string };

const FIELD_MESSAGES: Record<string, string> = {
  email: "Enter a valid email address so we can reply.",
  name: `Keep the name under ${NAME_MAX} characters.`,
  topic: "Choose what it's about.",
  message: `Write between ${MESSAGE_MIN} and ${MESSAGE_MAX.toLocaleString("en-US")} characters.`,
};

export function parseHelpRequest(body: unknown): ParsedHelpRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "invalid", message: "That request couldn't be read. Reload the page and try again." };
  }
  const trap = (body as Record<string, unknown>)[HONEYPOT_FIELD];
  if (typeof trap === "string" && trap.trim() !== "") return { kind: "honeypot" };

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return { kind: "invalid", message: FIELD_MESSAGES[field] ?? "Check the form and try again." };
  }
  return { kind: "store", data: parsed.data };
}
