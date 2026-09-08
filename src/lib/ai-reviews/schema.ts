import { z } from "zod";
import { PERIOD_KINDS } from "./period";

// Validators for the AI review feature: what the client may ask for, and --
// the larger half -- what the model is allowed to have returned.
//
// **Why the model's output is validated at all.** The review is rendered into
// fixed sections with a numeric score bar, not printed as prose. Rendering
// unvalidated model output would mean every component defending itself
// against a missing field, a string where a number belongs, or a 40,000-word
// "action item". Validating once at the boundary means the renderer can trust
// its props, and a malformed reply becomes one clear error instead of a
// half-drawn card.
//
// **Tolerant where it costs nothing, strict where it matters.** Repairing a
// bad reply costs a second provider call on the user's own quota, so this
// only rejects output that is structurally unusable. Cosmetic slips a model
// makes constantly -- a score of 105, "Partially Followed" instead of
// `partially_followed`, a numeric score sent as a string -- are normalised
// rather than bounced.

// ---- Request ---------------------------------------------------------------

export const tradeReviewSchema = z.object({
  tradeId: z.uuid("Pick a trade to review."),
  keyId: z.uuid("Pick which saved key to use."),
});

/**
 * A period review request.
 *
 * The dates are only read for `kind: "custom"` -- weekly and monthly resolve
 * their own window server-side from the user's timezone (see period.ts), so a
 * client cannot widen a "weekly" review into a year by sending its own dates.
 * They are validated as calendar days here and re-validated by
 * `resolvePeriod`, which is what actually rejects an impossible date like
 * 2026-02-31.
 */
export const periodReviewSchema = z.object({
  keyId: z.uuid("Pick which saved key to use."),
  kind: z.enum(PERIOD_KINDS),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date.")
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date.")
    .optional(),
});

// ---- Model output ----------------------------------------------------------

/**
 * Bounded free text from the model.
 *
 * The cap is a memory and storage bound, not a style rule: this string is
 * written to a jsonb column and rendered into a card, and a model that loops
 * can emit megabytes. 800 characters is several sentences -- far more than
 * any of these fields needs.
 */
const prose = (max = 800) => z.string().trim().max(max);

/**
 * Same, but a missing, null or blank value is normalised to "" rather than
 * rejected -- and so is a number, which models occasionally return for a
 * field that reads like it wants one. `.nullish()` rather than a union with
 * `z.undefined()`: only the former marks the key optional on the enclosing
 * object, so the union form rejects a reply that simply omits the field.
 */
const optionalProse = (max = 800) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v == null ? "" : String(v).trim().slice(0, max)));

/**
 * A list of short findings.
 *
 * Bounded at 10 rather than at the number actually displayed. Where the spec
 * asks for a specific count -- "1-3 concrete actions" -- that limit is applied
 * when rendering, not here: a model returning five good action items has not
 * produced an invalid review, and spending a second provider call to make it
 * return three would be paying real tokens for a presentational detail.
 */
const findings = z
  .array(z.unknown())
  .max(50)
  .transform((items) =>
    items
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item !== "")
      .slice(0, 10)
      .map((item) => item.slice(0, 800)),
  );

/**
 * A 0-100 score, clamped rather than rejected.
 *
 * Models overshoot the top of a stated range often enough that treating it as
 * a hard failure would spend a repair call on a number that is one `Math.min`
 * away from being fine. The clamp is visible in the rendered bar either way,
 * and nothing downstream can be broken by a value that is in range by
 * construction.
 */
const score = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : Number(v)))
  .refine((v) => Number.isFinite(v), { message: "score must be a number" })
  .transform((v) => Math.min(100, Math.max(0, Math.round(v))));

/**
 * A sub-score the model is allowed to decline.
 *
 * Nullable on purpose, and it is the more important half of §3's "never
 * invent missing information": a trade with no emotion logged gives the model
 * nothing to score emotional discipline on. Forcing a number there would
 * manufacture the exact fabricated figure the whole prompt is built to
 * prevent, so "no basis to judge this" is a first-class answer and renders as
 * "—".
 */
const optionalScore = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null;
  });

export const RULE_STATUSES = [
  "followed",
  "partially_followed",
  "not_followed",
  "unknown",
] as const;

export type RuleStatus = (typeof RULE_STATUSES)[number];

/**
 * Normalises whatever casing/spacing/phrasing the model used into one of the
 * four states §2 asks for.
 *
 * Anything unrecognised becomes "unknown" rather than failing. That is the
 * safe direction: "unknown" understates what the model claimed, while
 * guessing between "followed" and "not_followed" would put a verdict on the
 * user's trade that no model actually gave.
 */
const ruleStatus = z.unknown().transform((v): RuleStatus => {
  const raw = typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (raw === "followed" || raw === "fully_followed") return "followed";
  if (raw === "not_followed" || raw === "broken" || raw === "violated") return "not_followed";
  if (raw.startsWith("partial")) return "partially_followed";
  return "unknown";
});

const ruleAdherence = z
  .array(z.unknown())
  .max(50)
  .transform((items) =>
    items
      .map((item) => {
        const obj = (typeof item === "object" && item !== null ? item : {}) as Record<
          string,
          unknown
        >;
        return {
          rule: typeof obj.rule === "string" ? obj.rule.trim().slice(0, 300) : "",
          status: ruleStatus.parse(obj.status),
          note: typeof obj.note === "string" ? obj.note.trim().slice(0, 500) : "",
        };
      })
      // A rule with no name is unrenderable -- there is nothing to label the
      // badge with -- so it is dropped rather than shown as an empty row.
      .filter((entry) => entry.rule !== "")
      .slice(0, 10),
  );

/**
 * The full trade review, matching §15's suggested schema.
 *
 * `overall_assessment` and `score` are the only required fields: they are the
 * headline, and a reply missing either is not a review. Everything else is
 * allowed to be absent, because a sparse trade genuinely has less to say
 * about it -- and an empty "what went well" is more honest than a padded one.
 */
export const tradeReviewContentSchema = z.object({
  overall_assessment: prose(1200).min(1, "the review has no assessment"),
  score,
  score_breakdown: z
    .object({
      setup_quality: optionalScore,
      entry_quality: optionalScore,
      risk_management: optionalScore,
      exit_management: optionalScore,
      plan_adherence: optionalScore,
      emotional_discipline: optionalScore,
    })
    // A model that omits the breakdown entirely still produced a usable
    // review; the card just renders the headline score alone.
    .partial()
    .nullish()
    .transform((v) => v ?? {}),
  what_went_well: findings.nullish().transform((v) => v ?? []),
  what_could_improve: findings.nullish().transform((v) => v ?? []),
  biggest_mistake: optionalProse(),
  best_decision: optionalProse(),
  rule_adherence: ruleAdherence.nullish().transform((v) => v ?? []),
  emotional_analysis: findings.nullish().transform((v) => v ?? []),
  action_items: findings.nullish().transform((v) => v ?? []),
  /**
   * Fields the journal did not contain, named by the model.
   *
   * Not in §15's suggested schema, added because §3 requires the AI to
   * "clearly identify missing information" -- and a dedicated field is the
   * only way to render that as a distinct, scannable note rather than hoping
   * it mentioned the gap somewhere in the prose.
   */
  missing_information: findings.nullish().transform((v) => v ?? []),
});

export type TradeReviewContent = z.infer<typeof tradeReviewContentSchema>;

// ---- Period review output --------------------------------------------------

/**
 * How much weight a finding carries.
 *
 * `insufficient_data` is a first-class answer, not a failure: on a quiet week
 * the honest output is "there isn't enough here to call anything an edge".
 * Without somewhere to put that, a model asked for a "biggest edge" will
 * always name one, and naming an edge from four trades is precisely the
 * error the sample-size rules exist to prevent.
 */
export const CONFIDENCE_LEVELS = ["high", "medium", "low", "insufficient_data"] as const;

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** Normalises the model's phrasing, defaulting to the most cautious reading.
 *  Anything unrecognised is treated as insufficient data rather than as a
 *  confident claim -- understating a finding is recoverable, overstating one
 *  is what puts a trader's money behind four trades of noise. */
const confidence = z.unknown().transform((v): ConfidenceLevel => {
  const raw = typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (raw === "high") return "high";
  if (raw === "medium" || raw === "moderate") return "medium";
  if (raw === "low") return "low";
  return "insufficient_data";
});

/** A headline finding: the claim, the numbers behind it, and how much to
 *  trust it. Evidence is a required part of the shape -- a finding with no
 *  figures under it is an opinion, and this feature's entire premise is that
 *  the trader can check the work. */
const finding = z.unknown().transform((v) => {
  const obj = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  return {
    finding: typeof obj.finding === "string" ? obj.finding.trim().slice(0, 800) : "",
    evidence: typeof obj.evidence === "string" ? obj.evidence.trim().slice(0, 800) : "",
    confidence: confidence.parse(obj.confidence),
  };
});

const patterns = z
  .array(z.unknown())
  .max(50)
  .transform((items) =>
    items
      .map((item) => {
        const obj = (typeof item === "object" && item !== null ? item : {}) as Record<
          string,
          unknown
        >;
        return {
          pattern: typeof obj.pattern === "string" ? obj.pattern.trim().slice(0, 300) : "",
          evidence: typeof obj.evidence === "string" ? obj.evidence.trim().slice(0, 600) : "",
          confidence: confidence.parse(obj.confidence),
        };
      })
      .filter((p) => p.pattern !== "")
      .slice(0, 8),
  );

const strategyBreakdown = z
  .array(z.unknown())
  .max(50)
  .transform((items) =>
    items
      .map((item) => {
        const obj = (typeof item === "object" && item !== null ? item : {}) as Record<
          string,
          unknown
        >;
        return {
          strategy: typeof obj.strategy === "string" ? obj.strategy.trim().slice(0, 200) : "",
          verdict: typeof obj.verdict === "string" ? obj.verdict.trim().slice(0, 600) : "",
          sample_note:
            typeof obj.sample_note === "string" ? obj.sample_note.trim().slice(0, 300) : "",
        };
      })
      .filter((s) => s.strategy !== "")
      .slice(0, 12),
  );

/**
 * The full period review.
 *
 * Only `performance_summary` is required. A genuinely quiet period should
 * produce a review that is mostly empty rather than one padded out to look
 * substantial -- an invented "biggest edge" on a three-trade week is worse
 * than a blank one.
 */
export const periodReviewContentSchema = z.object({
  performance_summary: prose(1500).min(1, "the review has no summary"),
  what_went_well: findings.nullish().transform((v) => v ?? []),
  what_went_wrong: findings.nullish().transform((v) => v ?? []),
  biggest_edge: finding.nullish().transform(
    (v) => v ?? { finding: "", evidence: "", confidence: "insufficient_data" as ConfidenceLevel },
  ),
  biggest_leak: finding.nullish().transform(
    (v) => v ?? { finding: "", evidence: "", confidence: "insufficient_data" as ConfidenceLevel },
  ),
  behavioral_patterns: patterns.nullish().transform((v) => v ?? []),
  strategy_breakdown: strategyBreakdown.nullish().transform((v) => v ?? []),
  risk_review: findings.nullish().transform((v) => v ?? []),
  period_comparison: optionalProse(1200),
  priorities: findings.nullish().transform((v) => v ?? []),
  missing_information: findings.nullish().transform((v) => v ?? []),
});

export type PeriodReviewContent = z.infer<typeof periodReviewContentSchema>;
