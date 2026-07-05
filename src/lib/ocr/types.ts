// Shared types for the offline screenshot-parsing pipeline.
//
// The pipeline turns a raw image into a set of DetectedField values, each
// carrying a confidence score and a human-readable source, then maps the ones
// that correspond to editable trade columns into `core` so the client can
// pre-fill the trade form. Fields that don't map to a column (broker, order
// id, PnL used only for cross-checking) are surfaced separately in `extra`.

import type { EditableCoreField } from "../trades/types";

/** Axis-aligned bounding box in source-image pixels. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One line of recognized text with its position and OCR confidence (0..1). */
export interface OcrLine {
  text: string;
  confidence: number;
  box: Box;
  /** Center point + height, precomputed for spatial reasoning. */
  cx: number;
  cy: number;
  height: number;
}

/** Result of a single OCR pass over one preprocessed image. */
export interface OcrPassResult {
  lines: OcrLine[];
  engine: string;
  variant: string;
  /** Path to the preprocessed image the winning pass ran on (for ROI re-OCR). */
  variantPath: string;
  meanConfidence: number;
  rawText: string;
}

export interface OcrEngine {
  readonly name: string;
  /** Recognize text from an image on disk. Must never throw for bad input. */
  recognize(imagePath: string): Promise<OcrLine[]>;
}

/**
 * Every field the parser can extract. Keys that share a name with an
 * EditableCoreField map straight onto the trade form; the rest are "extra"
 * (no column yet) or "derived" (used only for cross-validation).
 */
export type FieldKey =
  // --- writable core columns ---
  | "ticker"
  | "company_name"
  | "asset_type"
  | "market"
  | "direction"
  | "status"
  | "entry_price"
  | "exit_price"
  | "stop_loss"
  | "take_profit"
  | "shares"
  | "position_size"
  | "dollar_amount"
  | "risk_amount"
  | "risk_percent"
  | "entry_date"
  | "exit_date"
  // --- derived: used for cross-validation, never written ---
  | "pnl_amount"
  | "pnl_percent"
  | "risk_reward_ratio"
  | "current_price"
  | "average_price"
  // --- extra: no column, surfaced for the user ---
  | "broker"
  | "account"
  | "exchange"
  | "currency"
  | "order_id"
  | "order_type";

export type FieldValue = string | number;

export interface DetectedField {
  key: FieldKey;
  value: FieldValue;
  /** Final confidence after label match, OCR confidence, and validation. */
  confidence: number;
  /** Plain-language provenance, e.g. "beside 'Stop Loss' label". */
  source: string;
  /** The raw OCR text this value came from (for debugging). */
  raw?: string;
  /** Bounding box of the value's OCR line, in variant-space pixels (see
   * Preprocessed.meta.scale). Used to sample source pixels for disabled/greyed
   * field detection; never sent to the client. */
  box?: Box;
}

export type DetectedFields = Partial<Record<FieldKey, DetectedField>>;

export type ScreenshotType =
  | "order_ticket"
  | "open_position"
  | "closed_position"
  | "pending_order"
  | "trade_confirmation"
  | "history"
  | "portfolio"
  | "performance"
  | "chart"
  | "unknown";

/** The trade columns that OCR can populate (subset of EditableCoreField). */
export const OCR_CORE_FIELDS = [
  "ticker",
  "company_name",
  "asset_type",
  "market",
  "direction",
  "status",
  "entry_price",
  "exit_price",
  "stop_loss",
  "take_profit",
  "shares",
  "position_size",
  "dollar_amount",
  "risk_amount",
  "risk_percent",
  "entry_date",
  "exit_date",
] as const satisfies readonly EditableCoreField[];

export type OcrCoreField = (typeof OCR_CORE_FIELDS)[number];

/** One field ready to drop into the trade form, with its confidence. */
export interface CoreFieldResult {
  value: FieldValue;
  confidence: number;
  source: string;
}

/** A validation observation, kept in the debug log. */
export interface ValidationNote {
  field: FieldKey | "cross";
  ok: boolean;
  message: string;
}

/** Structured debug log — the spec's logging requirement. */
export interface OcrLog {
  screenshotType: ScreenshotType;
  broker: string | null;
  engine: string;
  chosenVariant: string;
  meanConfidence: number;
  rawText: string;
  detectedLabels: string[];
  validation: ValidationNote[];
  missingFields: FieldKey[];
  rejectedFields: { key: FieldKey; reason: string }[];
  timings: Record<string, number>;
}

/** The pipeline's output, returned by the API route to the client. */
export interface ParseResult {
  /** Whether any usable field was extracted. */
  ok: boolean;
  /** Fields that map to editable trade columns, keyed by column name. */
  core: Partial<Record<OcrCoreField, CoreFieldResult>>;
  /** Extracted values with no column (broker, order id, current price, ...). */
  extra: { key: FieldKey; label: string; value: FieldValue; confidence: number }[];
  screenshotType: ScreenshotType;
  broker: string | null;
  log: OcrLog;
}

/**
 * Auto-fill threshold. Fields at or above this confidence are pre-filled;
 * below it they are reported (so the UI can show a low-confidence hint) but
 * left blank on the form. The spec's rule: never guess.
 */
export const AUTOFILL_CONFIDENCE = 0.55;

export const FIELD_LABELS: Record<FieldKey, string> = {
  ticker: "Ticker",
  company_name: "Company Name",
  asset_type: "Asset Type",
  market: "Market",
  direction: "Direction",
  status: "Status",
  entry_price: "Entry Price",
  exit_price: "Exit Price",
  stop_loss: "Stop Loss",
  take_profit: "Take Profit",
  shares: "Shares",
  position_size: "Position Size",
  dollar_amount: "Dollar Amount",
  risk_amount: "Risk Amount",
  risk_percent: "Risk %",
  entry_date: "Entry Date",
  exit_date: "Exit Date",
  pnl_amount: "Profit/Loss $",
  pnl_percent: "Profit/Loss %",
  risk_reward_ratio: "Risk/Reward",
  current_price: "Current Price",
  average_price: "Average Price",
  broker: "Broker",
  account: "Account",
  exchange: "Exchange",
  currency: "Currency",
  order_id: "Order ID",
  order_type: "Order Type",
};

/** Keys that are numeric (for normalization + validation). */
export const NUMERIC_FIELDS = new Set<FieldKey>([
  "entry_price",
  "exit_price",
  "stop_loss",
  "take_profit",
  "shares",
  "position_size",
  "dollar_amount",
  "risk_amount",
  "risk_percent",
  "pnl_amount",
  "pnl_percent",
  "risk_reward_ratio",
  "current_price",
  "average_price",
]);

/** Keys that are ISO dates. */
export const DATE_FIELDS = new Set<FieldKey>(["entry_date", "exit_date"]);

/** Payload the client applies onto the trade form. */
export type ApplyCoreFields = Partial<Record<OcrCoreField, FieldValue>>;

/**
 * Client helper: the detected core fields worth auto-filling (confidence at or
 * above the threshold), as [column, value] pairs ready for updateCoreField.
 */
export function autofillableCore(
  result: Pick<ParseResult, "core">,
  min = AUTOFILL_CONFIDENCE,
): [OcrCoreField, FieldValue][] {
  return (Object.keys(result.core) as OcrCoreField[])
    .filter((k) => (result.core[k]?.confidence ?? 0) >= min)
    .map((k) => [k, result.core[k]!.value]);
}

export function boxFromPoints(points: number[][]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

export function makeLine(text: string, confidence: number, box: Box): OcrLine {
  return {
    text,
    confidence,
    box,
    cx: (box.x0 + box.x1) / 2,
    cy: (box.y0 + box.y1) / 2,
    height: Math.max(1, box.y1 - box.y0),
  };
}
