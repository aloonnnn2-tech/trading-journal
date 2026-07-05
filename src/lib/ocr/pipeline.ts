// Pipeline orchestrator. Runs the stages in order, recovers from stage errors
// by returning partial results (never throws to the caller), and produces the
// structured ParseResult the API route sends to the client.
//
//   image → validate/preprocess → OCR (multi-pass) → classify + layout
//         → semantic parse → dedupe → validate/cross-check → map + log

import type {
  CoreFieldResult,
  DetectedFields,
  FieldKey,
  OcrCoreField,
  ParseResult,
} from "./types";
import { FIELD_LABELS, OCR_CORE_FIELDS } from "./types";
import { preprocessImage, type Preprocessed } from "./preprocess";
import { runOcr } from "./engines";
import { Layout } from "./layout";
import { classifyScreenshot, detectBroker } from "./classify";
import { parseSemantic } from "./semantic";
import { ocrRoi } from "./roi";
import { dedupe } from "./dedupe";
import { demoteDisabledFields } from "./disabled";
import { validate } from "./validate";
import { buildLog } from "./logging";

const CORE_SET = new Set<FieldKey>(OCR_CORE_FIELDS);

// Fields the ROI (panel) pass is allowed to contribute. Identity fields —
// ticker, direction, status, company, market — come only from the full pass.
const ROI_FIELDS = new Set<FieldKey>([
  "entry_price",
  "exit_price",
  "stop_loss",
  "take_profit",
  "shares",
  "position_size",
  "dollar_amount",
  "risk_amount",
  "risk_percent",
  "current_price",
  "average_price",
  "pnl_amount",
  "pnl_percent",
  "risk_reward_ratio",
  "entry_date",
  "exit_date",
  "order_id",
  "order_type",
]);

function mapFields(fields: DetectedFields): Pick<ParseResult, "core" | "extra"> {
  const core: Partial<Record<OcrCoreField, CoreFieldResult>> = {};
  const extra: ParseResult["extra"] = [];
  for (const key of Object.keys(fields) as FieldKey[]) {
    const f = fields[key]!;
    if (CORE_SET.has(key)) {
      core[key as OcrCoreField] = { value: f.value, confidence: round(f.confidence), source: f.source };
    } else {
      extra.push({ key, label: FIELD_LABELS[key], value: f.value, confidence: round(f.confidence) });
    }
  }
  extra.sort((a, b) => b.confidence - a.confidence);
  return { core, extra };
}

const round = (n: number) => Number(n.toFixed(3));

export async function runOcrPipeline(buffer: Buffer): Promise<ParseResult> {
  const timings: Record<string, number> = {};
  const started = Date.now();
  let pre: Preprocessed | null = null;

  try {
    pre = await stage(timings, "preprocess", () => preprocessImage(buffer));
    const pass = await stage(timings, "ocr", () => runOcr(pre!.variants));

    const layout = new Layout(pass.lines);
    const screenshotType = classifyScreenshot(layout);
    const broker = detectBroker(layout);

    const candidatesFull = await stage(timings, "semantic", async () => parseSemantic(pass.lines));

    // Focused second pass over the panel region — cleaner, sharper text with the
    // chart noise cropped out. It contributes only panel value fields; ticker /
    // direction / status stay from the full pass (they live in the header, often
    // outside the cropped panel). ROI candidates go first so their sharper reads
    // win confidence ties.
    const roiLines = await stage(timings, "roi", () => ocrRoi(pass.variantPath, pass.lines).catch(() => []));
    const candidatesRoi = roiLines.length
      ? parseSemantic(roiLines).filter((c) => ROI_FIELDS.has(c.key))
      : [];

    const deduped = dedupe([...candidatesRoi, ...candidatesFull]);

    // Demote fields that look like greyed/disabled placeholder inputs (e.g. an
    // unchecked "Take Profit" price box) before cross-validation runs, so those
    // checks see the already-discounted confidence.
    const disabled = await stage(timings, "disabled", () => demoteDisabledFields(buffer, deduped, pre!.meta.scale));

    const { fields, notes, rejected } = validate(disabled.fields);
    notes.push(...disabled.notes);

    const { core, extra } = mapFields(fields);
    timings.total = Date.now() - started;

    const log = buildLog({ pass, screenshotType, broker, fields, notes, rejected, timings });
    const ok = Object.keys(core).length > 0 || extra.length > 0;
    return { ok, core, extra, screenshotType, broker, log };
  } catch (err) {
    // Total failure: return an empty-but-valid partial result. Never throw.
    timings.total = Date.now() - started;
    return emptyResult(err, timings);
  } finally {
    await pre?.cleanup();
  }
}

async function stage<T>(timings: Record<string, number>, name: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  try {
    return await fn();
  } finally {
    timings[name] = Date.now() - t;
  }
}

function emptyResult(err: unknown, timings: Record<string, number>): ParseResult {
  const message = err instanceof Error ? err.message : "unknown error";
  return {
    ok: false,
    core: {},
    extra: [],
    screenshotType: "unknown",
    broker: null,
    log: {
      screenshotType: "unknown",
      broker: null,
      engine: "none",
      chosenVariant: "none",
      meanConfidence: 0,
      rawText: "",
      detectedLabels: [],
      validation: [{ field: "cross", ok: false, message: `pipeline error: ${message}` }],
      missingFields: [...OCR_CORE_FIELDS],
      rejectedFields: [],
      timings,
    },
  };
}
