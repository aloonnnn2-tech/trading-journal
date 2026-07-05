// Field validation + cross-validation. Rejects impossible values outright and
// nudges confidence up or down based on plausibility and internal consistency
// (Entry×Shares≈Position Size, R/R math, PnL sign). The spec's rule holds:
// incorrect information is worse than missing, so failed hard checks drop the
// field entirely rather than lowering its score.

import type { DetectedField, DetectedFields, FieldKey, ValidationNote } from "./types";
import { CONF, adjust } from "./confidence";

export interface ValidationOutcome {
  fields: DetectedFields;
  notes: ValidationNote[];
  rejected: { key: FieldKey; reason: string }[];
}

const asNum = (f?: DetectedField): number | null =>
  f && typeof f.value === "number" && Number.isFinite(f.value) ? f.value : null;

export function validate(input: DetectedFields): ValidationOutcome {
  const fields: DetectedFields = { ...input };
  const notes: ValidationNote[] = [];
  const rejected: { key: FieldKey; reason: string }[] = [];

  const reject = (key: FieldKey, reason: string) => {
    delete fields[key];
    rejected.push({ key, reason });
    notes.push({ field: key, ok: false, message: `rejected: ${reason}` });
  };
  const note = (field: FieldKey | "cross", ok: boolean, message: string) => notes.push({ field, ok, message });

  // --- Per-field hard checks ------------------------------------------------
  const ticker = fields.ticker;
  if (ticker && typeof ticker.value === "string") {
    if (/^\d+$/.test(ticker.value)) reject("ticker", "ticker is purely numeric");
    else if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker.value)) reject("ticker", "ticker has invalid characters");
  }

  for (const key of ["entry_price", "exit_price", "stop_loss", "take_profit", "current_price", "average_price"] as const) {
    const n = asNum(fields[key]);
    if (n === null) continue;
    if (n <= 0) reject(key, "price must be positive");
    else if (n > 1e7) reject(key, "price implausibly large");
    else note(key, true, "price in range");
  }

  const shares = asNum(fields.shares);
  if (shares !== null) {
    if (shares <= 0) reject("shares", "quantity must be positive");
    // A quantity that looks like a 4-digit year is almost certainly a misread date.
    else if (Number.isInteger(shares) && shares >= 1900 && shares <= 2100) {
      fields.shares = { ...fields.shares!, confidence: adjust(fields.shares!.confidence, CONF.softFail) };
      note("shares", false, "quantity resembles a year — demoted");
    }
  }

  // Amounts/sizes/ratios that should always be positive — e.g. a "1,000 -
  // 1,200" range OCR misreads as negative (normalize.ts guards the common
  // case, but a bad read can still slip through) has nowhere else to be
  // caught for these fields.
  for (const key of ["position_size", "dollar_amount", "risk_amount", "risk_reward_ratio"] as const) {
    const n = asNum(fields[key]);
    if (n !== null && n <= 0) reject(key, `${key} must be positive`);
  }

  const riskPct = asNum(fields.risk_percent);
  if (riskPct !== null && (riskPct < 0 || riskPct > 100)) reject("risk_percent", "risk % out of 0–100 range");

  const pnlPct = asNum(fields.pnl_percent);
  if (pnlPct !== null && Math.abs(pnlPct) > 100000) reject("pnl_percent", "PnL % implausible");

  // Dates: entry must not be after exit.
  const entryDate = typeof fields.entry_date?.value === "string" ? Date.parse(fields.entry_date.value) : NaN;
  const exitDate = typeof fields.exit_date?.value === "string" ? Date.parse(fields.exit_date.value) : NaN;
  if (!Number.isNaN(entryDate) && !Number.isNaN(exitDate) && entryDate > exitDate) {
    fields.exit_date = fields.exit_date && { ...fields.exit_date, confidence: adjust(fields.exit_date.confidence, CONF.softFail) };
    note("cross", false, "entry date after exit date");
  }

  // --- Cross-validation -----------------------------------------------------
  const entry = asNum(fields.entry_price);
  const size = asNum(fields.position_size);
  const dollar = asNum(fields.dollar_amount);
  const sl = asNum(fields.stop_loss);
  const tp = asNum(fields.take_profit);
  const rr = asNum(fields.risk_reward_ratio);
  const qty = asNum(fields.shares);

  // Entry × Shares ≈ Position Size (or Dollar Amount).
  const notional = entry !== null && qty !== null ? entry * qty : null;
  if (notional !== null) {
    for (const [key, val] of [["position_size", size] as const, ["dollar_amount", dollar] as const]) {
      if (val === null) continue;
      const agree = approxEqual(notional, val, 0.03);
      const mult = agree ? CONF.crossAgree : CONF.crossDisagree;
      if (fields[key]) fields[key] = { ...fields[key]!, confidence: adjust(fields[key]!.confidence, mult) };
      if (fields.entry_price) fields.entry_price = { ...fields.entry_price, confidence: adjust(fields.entry_price.confidence, agree ? CONF.crossAgree : 1) };
      note("cross", agree, `Entry×Shares ${agree ? "≈" : "≠"} ${key} (${notional.toFixed(2)} vs ${val})`);
    }
  }

  // Risk/Reward ≈ |TP-Entry| / |Entry-SL|.
  if (entry !== null && sl !== null && tp !== null && entry !== sl) {
    const computed = Math.abs(tp - entry) / Math.abs(entry - sl);
    if (rr !== null) {
      const agree = approxEqual(computed, rr, 0.15);
      if (fields.risk_reward_ratio) {
        fields.risk_reward_ratio = { ...fields.risk_reward_ratio, confidence: adjust(fields.risk_reward_ratio.confidence, agree ? CONF.crossAgree : CONF.crossDisagree) };
      }
      note("cross", agree, `R/R ${agree ? "≈" : "≠"} computed ${computed.toFixed(2)}`);
    }
    // SL/TP on the correct sides for the stated direction. Unlike a plain
    // log note, an impossible configuration (stop above entry on a long,
    // e.g.) demotes stop_loss/take_profit — the values themselves are
    // usually still real numbers the OCR read correctly, just misassigned,
    // so full rejection would go too far, but they must not sail through at
    // full confidence.
    const dir = fields.direction?.value;
    const wrongSide = (dir === "long" && !(sl < entry && tp > entry)) || (dir === "short" && !(sl > entry && tp < entry));
    if (dir === "long" || dir === "short") {
      note("cross", !wrongSide, wrongSide ? `${dir}: SL/TP on the wrong side of entry` : `${dir}: SL/TP on the expected side of entry`);
      if (wrongSide) {
        if (fields.stop_loss) fields.stop_loss = { ...fields.stop_loss, confidence: adjust(fields.stop_loss.confidence, CONF.crossDisagree) };
        if (fields.take_profit) fields.take_profit = { ...fields.take_profit, confidence: adjust(fields.take_profit.confidence, CONF.crossDisagree) };
      }
    }
  }

  return { fields, notes, rejected };
}

function approxEqual(a: number, b: number, tol: number): boolean {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / denom <= tol;
}
