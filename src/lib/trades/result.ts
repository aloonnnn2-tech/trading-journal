import type { TradeResult } from "./types";

// Single source of truth for mapping a net dollar P/L to the `result` enum.
// `dollar_pl` is already net of commission (see computeDerivedFields), so
// this is what keeps "win"/"loss" honest for trades where fees eat a thin
// target-hit profit -- callers should prefer this over trusting a `result`
// set anywhere else (e.g. decideAutoExecution's pre-commission guess).
export function resultFromPL(pl: number | null | undefined): TradeResult {
  if (typeof pl !== "number") return "open";
  if (pl > 0) return "win";
  if (pl < 0) return "loss";
  return "break_even";
}
