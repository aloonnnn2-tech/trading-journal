import type { PeriodReviewContent, TradeReviewContent } from "@/lib/ai-reviews/schema";

// Flattening a review for the clipboard.
//
// What a trader wants to paste into their own journal, a message or a doc is
// the review as prose -- not the JSON it happens to be stored as. These
// produce the same sections the cards render, in the same order, so what gets
// pasted matches what was on screen.
//
// Both review types live here rather than beside their own components because
// the shape of the problem is identical, and keeping them together is what
// stops the two drifting into different formats for the same idea.

function list(lines: string[], title: string, items: string[]): void {
  if (items.length > 0) lines.push("", title, ...items.map((i) => `- ${i}`));
}

export function tradeReviewToText(c: TradeReviewContent): string {
  const lines: string[] = [`AI Trade Review — ${c.score}/100`, "", c.overall_assessment];

  list(lines, "What went well:", c.what_went_well);
  list(lines, "What could be improved:", c.what_could_improve);
  if (c.biggest_mistake) lines.push("", `Biggest mistake: ${c.biggest_mistake}`);
  if (c.best_decision) lines.push("", `Best decision: ${c.best_decision}`);
  if (c.rule_adherence.length > 0) {
    lines.push(
      "",
      "Rule adherence:",
      ...c.rule_adherence.map(
        (r) => `- [${r.status.replace(/_/g, " ")}] ${r.rule}${r.note ? ` — ${r.note}` : ""}`,
      ),
    );
  }
  list(lines, "Emotional analysis:", c.emotional_analysis);
  list(lines, "Not recorded:", c.missing_information);
  list(lines, "Next trade:", c.action_items.slice(0, 3));

  return lines.join("\n");
}

/** Confidence travels with every finding in the pasted text too. Stripping it
 *  would turn "interesting, but only four trades" into a flat claim the
 *  moment it left the app -- which is the one way this feature could actually
 *  mislead someone. */
function finding(label: string, value: PeriodReviewContent["biggest_edge"]): string[] {
  if (!value.finding) return ["", `${label}: none supported by this period's data.`];
  return [
    "",
    `${label} (${value.confidence.replace(/_/g, " ")}): ${value.finding}`,
    ...(value.evidence ? [`  Evidence: ${value.evidence}`] : []),
  ];
}

export function periodReviewToText(
  c: PeriodReviewContent,
  meta: { label: string; trades: number },
): string {
  const lines: string[] = [
    `AI Period Review — ${meta.label} (${meta.trades} trades)`,
    "",
    c.performance_summary,
    ...finding("Biggest edge", c.biggest_edge),
    ...finding("Biggest leak", c.biggest_leak),
  ];

  list(lines, "What went well:", c.what_went_well);
  list(lines, "What went wrong:", c.what_went_wrong);

  if (c.behavioral_patterns.length > 0) {
    lines.push(
      "",
      "Behavioural patterns:",
      ...c.behavioral_patterns.map(
        (p) =>
          `- ${p.pattern} (${p.confidence.replace(/_/g, " ")})${p.evidence ? ` — ${p.evidence}` : ""}`,
      ),
    );
  }
  if (c.strategy_breakdown.length > 0) {
    lines.push(
      "",
      "Strategy breakdown:",
      ...c.strategy_breakdown.map(
        (s) =>
          `- ${s.strategy}: ${s.verdict}${s.sample_note ? ` (${s.sample_note})` : ""}`,
      ),
    );
  }

  list(lines, "Risk management:", c.risk_review);
  if (c.period_comparison) lines.push("", `Versus the previous period: ${c.period_comparison}`);
  list(lines, "Not recorded:", c.missing_information);
  list(lines, "Next period:", c.priorities.slice(0, 3));

  return lines.join("\n");
}
