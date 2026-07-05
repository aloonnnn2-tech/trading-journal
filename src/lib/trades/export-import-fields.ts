import { EDITABLE_CORE_FIELDS } from "./types";

// Columns included in an export, in order: every editable core column,
// plus the server-computed P/L columns (read-only on import).
export const EXPORT_CORE_COLUMNS = [
  ...EDITABLE_CORE_FIELDS,
  "dollar_pl",
  "percent_return",
  "r_multiple",
  "risk_reward_ratio",
] as const;
