// "How did you hear about us?" -- asked once, the first time a new account
// signs in (Alon, 2026-11-19), so the 7-and-counting sign-ups can be traced to
// the channel that brought them.
//
// Stored on the account itself (Supabase auth user metadata), next to the
// sign-up source from the first visit's link (src/lib/tracking/attribution.ts).
// No table or migration: the answer is the user's own self-report, which is
// exactly what user metadata is for, and admin reads it with the service role.

export const HEARD_FROM_OPTIONS = [
  { value: "youtube", label: "YouTube" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "google", label: "Google search" },
  { value: "other", label: "Other" },
] as const;

export type HeardFrom = (typeof HEARD_FROM_OPTIONS)[number]["value"];

/** What the account stores: one of the options, or "skipped". */
export type HeardFromAnswer = HeardFrom | "skipped";

export function isHeardFromAnswer(value: unknown): value is HeardFromAnswer {
  return value === "skipped" || HEARD_FROM_OPTIONS.some((o) => o.value === value);
}

/** The label to show for a stored answer, or null when there is none. */
export function heardFromLabel(value: unknown): string | null {
  if (value === "skipped") return "Skipped";
  return HEARD_FROM_OPTIONS.find((o) => o.value === value)?.label ?? null;
}

/**
 * Whether to ask: only an account that has not been through the first-run
 * flow yet and has no answer (or skip) on record. Existing accounts are never
 * asked retroactively.
 */
export function shouldAskHeardFrom(hasCompletedTour: boolean, metadata: Record<string, unknown> | null | undefined): boolean {
  if (hasCompletedTour) return false;
  return !isHeardFromAnswer(metadata?.heard_from);
}

/** Answers per option, most first, for the admin page. Unanswered accounts are left out. */
export function tallyHeardFrom(answers: unknown[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of answers) {
    const label = heardFromLabel(a);
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}
