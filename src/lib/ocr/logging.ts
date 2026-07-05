// Assembles the structured debug log the spec asks for. Kept separate so the
// orchestrator stays readable and the log shape lives in one place.

import type { DetectedFields, FieldKey, OcrLog, OcrPassResult, ScreenshotType, ValidationNote } from "./types";
import { FIELD_LABELS, OCR_CORE_FIELDS } from "./types";

export function buildLog(args: {
  pass: OcrPassResult;
  screenshotType: ScreenshotType;
  broker: string | null;
  fields: DetectedFields;
  notes: ValidationNote[];
  rejected: { key: FieldKey; reason: string }[];
  timings: Record<string, number>;
}): OcrLog {
  const { pass, fields, notes, rejected, timings } = args;
  const detectedLabels = (Object.keys(fields) as FieldKey[]).map((k) => FIELD_LABELS[k]);
  const missingFields = OCR_CORE_FIELDS.filter((k) => !fields[k]) as FieldKey[];

  return {
    screenshotType: args.screenshotType,
    broker: args.broker,
    engine: pass.engine,
    chosenVariant: pass.variant,
    meanConfidence: Number(pass.meanConfidence.toFixed(3)),
    rawText: pass.rawText,
    detectedLabels,
    validation: notes,
    missingFields,
    rejectedFields: rejected,
    timings,
  };
}
