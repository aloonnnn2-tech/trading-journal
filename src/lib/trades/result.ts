import type { TradeResult } from "./types";

// Single source of truth for mapping a net dollar P/L to the `result` enum.
// `dollar_pl` is already net of commission (see computeDerivedFields), so
// this is what keeps "win"/"loss" honest for trades where fees eat a thin
// target-hit profit -- callers should prefer this over trusting a `result`
// set anywhere else (e.g. decideAutoExecution's pre-commission guess).
//
// `pl` being non-numeric here means two different things depending on the
// caller, and this function alone can't tell them apart: for a trade that's
// still open, "no P/L yet" genuinely means "open" -- that's correct. For a
// trade being marked *closed* without enough data to compute a P/L (missing
// entry/exit/shares), "open" is wrong: it produces a row with
// status: "closed", result: "open", which the trades list renders as two
// contradictory badges. Callers that already know the trade is closed must
// use resultForClosedTrade below instead of calling this directly.
export function resultFromPL(pl: number | null | undefined): TradeResult {
  if (typeof pl !== "number") return "open";
  if (pl > 0) return "win";
  if (pl < 0) return "loss";
  return "break_even";
}

// For a trade already known to be closed. The only difference from
// resultFromPL is the non-numeric case: a finished trade whose P/L can't be
// computed is recorded as break-even, not "open" -- keeping the badge
// consistent with the status and keeping it out of the win/loss counts,
// rather than reproducing the contradictory pair above.
//
// This used to be a copy-pasted ternary at every call site (the cron sweep,
// the CSV importer, and -- until this function existed -- three more that
// had quietly fallen out of sync: updateTrade, restoreTradeVersion, and the
// commission-rules bulk recalculation). One implementation instead of six
// copies is the point: the next caller that needs "what's this trade's
// result" for a closed trade should call this, not re-derive the guard.
export function resultForClosedTrade(pl: number | null | undefined): TradeResult {
  return typeof pl === "number" ? resultFromPL(pl) : "break_even";
}
