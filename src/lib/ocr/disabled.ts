// Disabled/placeholder field detection. Broker order panels often show a
// greyed-out placeholder value in an unchecked "Take Profit" / "Stop Loss"
// price box — the OCR reads it as a normal number, but the trade was never
// actually placed with that value. Text alone can't tell a real value from a
// placeholder, but the *pixels* can: a real value is rendered in the theme's
// normal high-contrast text color, while a disabled placeholder is rendered in
// a muted grey close to the input's own background — low local contrast.
//
// This samples the local contrast behind each detected numeric field (from the
// original, un-preprocessed image) and demotes any field whose contrast is a
// clear outlier against the other fields found in the same screenshot.

import sharp from "sharp";
import type { Box, DetectedFields, FieldKey, ValidationNote } from "./types";
import { CONF, adjust } from "./confidence";

// Only price/amount fields — the ones broker UIs render as greyed checkboxes'
// price inputs. Dates, tickers, and text fields aren't shown this way.
const CHECKABLE: ReadonlySet<FieldKey> = new Set([
  "entry_price",
  "exit_price",
  "stop_loss",
  "take_profit",
  "position_size",
  "dollar_amount",
  "risk_amount",
  "risk_percent",
  "current_price",
  "average_price",
]);

export interface DisabledResult {
  fields: DetectedFields;
  notes: ValidationNote[];
}

async function boxContrast(buffer: Buffer, box: Box, scale: number, imgW: number, imgH: number): Promise<number | null> {
  const pad = 3;
  const x0 = Math.max(0, Math.floor(box.x0 / scale) - pad);
  const y0 = Math.max(0, Math.floor(box.y0 / scale) - pad);
  const x1 = Math.min(imgW, Math.ceil(box.x1 / scale) + pad);
  const y1 = Math.min(imgH, Math.ceil(box.y1 / scale) + pad);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 4 || h < 4) return null;
  try {
    // sharp's .stats() doesn't reliably apply a preceding .extract() in this
    // vips build — it silently computes over the full source image instead of
    // the crop. Materializing the crop to a buffer first, then taking stats
    // from a fresh sharp() on that buffer, forces the crop to actually apply.
    const cropped = await sharp(buffer).extract({ left: x0, top: y0, width: w, height: h }).toBuffer();
    // Greyscale-only contrast wrongly reads saturated colored text (a red
    // stop-loss, a green take-profit) as low-contrast, because converting to
    // luminance can flatten a color that's still highly distinct from its
    // background. Take the strongest per-channel contrast instead, so a value
    // rendered in color reads as "high contrast" exactly like black-on-white
    // text does — only genuinely washed-out/greyed text scores low on every
    // channel at once.
    const stats = await sharp(cropped).stats();
    const channelStdevs = stats.channels.slice(0, 3).map((c) => c.stdev);
    return channelStdevs.length ? Math.max(...channelStdevs) : null;
  } catch {
    return null;
  }
}

/**
 * Demote fields whose rendered contrast is far below the other fields found
 * in the same screenshot. Needs at least 3 comparable samples to establish a
 * baseline — on a simple 1-2 field screenshot there's nothing to compare
 * against, so it's a no-op rather than a guess.
 */
export async function demoteDisabledFields(buffer: Buffer, fields: DetectedFields, scale: number): Promise<DisabledResult> {
  const notes: ValidationNote[] = [];
  const keys = (Object.keys(fields) as FieldKey[]).filter((k) => CHECKABLE.has(k) && fields[k]?.box);
  if (keys.length < 3) return { fields, notes };

  const meta = await sharp(buffer).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;
  if (!imgW || !imgH) return { fields, notes };

  const samples: { key: FieldKey; contrast: number }[] = [];
  for (const key of keys) {
    const box = fields[key]!.box!;
    const c = await boxContrast(buffer, box, scale, imgW, imgH);
    if (c !== null) samples.push({ key, contrast: c });
  }
  if (samples.length < 3) return { fields, notes };

  const sorted = [...samples].sort((a, b) => a.contrast - b.contrast);
  const median = sorted[Math.floor(sorted.length / 2)].contrast;
  // If the whole image is inherently low-contrast (e.g. a soft screenshot),
  // relative comparison isn't a reliable signal — skip rather than guess.
  if (median < 10) return { fields, notes };

  const next: DetectedFields = { ...fields };
  for (const { key, contrast } of samples) {
    if (contrast < median * 0.4) {
      next[key] = { ...next[key]!, confidence: adjust(next[key]!.confidence, CONF.softFail) };
      notes.push({ field: key, ok: false, message: `looks greyed/disabled (contrast ${contrast.toFixed(1)} vs median ${median.toFixed(1)}) — confidence reduced` });
    }
  }
  return { fields: next, notes };
}
