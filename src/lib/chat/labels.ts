// Plain-language phrases for tool names, shared by the server (stream
// events) and the client (folding stored rows), so the activity strip reads
// the same whether it was streamed live or loaded from the database.
//
// Anything unlisted falls back to a neutral phrase. The name is chosen by the
// MODEL (and stored as it was chosen), so an injected instruction could make
// it say anything; a new tool must be added here to get a label, and until
// then it shows as "used a tool" rather than as whatever string arrived.
export const TOOL_LABELS: Record<string, string> = {
  query_trades: "checked your trades",
  compute_stats: "computed your stats",
  get_trade: "opened a trade",
  get_trade_history: "read a trade's edit history",
  get_account: "checked your account",
  list_strategies: "read your strategies",
  list_custom_fields: "read your custom fields",
  list_folders: "read your folders",
  list_commission_rules: "read your commission rules",
  get_settings: "checked your settings",
  get_period_report: "built a period report",
  get_report: "ran an analytics report",
  get_reviews: "read your past reviews",
};

export function labelForTool(name: string): string {
  return TOOL_LABELS[name] ?? "used a tool";
}

/** Dedupes labels in first-seen order: "checked your trades · computed your stats". */
export function describeActivity(names: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const label = labelForTool(n);
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out.join(" · ");
}
