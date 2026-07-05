// Region-of-interest second pass. On a full chart screenshot the order/position
// panel is a small, dense corner while the chart axis floods the rest with
// numbers. We locate the cluster of *label* lines (Entry/Stop/Take Profit/…),
// crop a padded box around it from the winning preprocessed image, upscale it
// so the small panel text is sharp, and re-OCR just that crop. The caller
// parses these cleaner lines and merges them with the full-image result.

import sharp from "sharp";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { OcrLine } from "./types";
import { makeLine } from "./types";
import { matchLabel } from "./labels";
import { paddleEngine } from "./engines";

function leadingLabel(text: string): string | null {
  const m = text.match(/^[A-Za-z][A-Za-z /&]{1,22}/);
  return m ? m[0].trim() : null;
}

export async function ocrRoi(variantPath: string, lines: OcrLine[]): Promise<OcrLine[]> {
  if (!variantPath || lines.length < 5) return [];

  // Lines whose leading phrase matches a known field label anchor the panel.
  const labelBoxes = lines
    .filter((l) => {
      const lead = leadingLabel(l.text);
      const m = lead ? matchLabel(lead) : null;
      return m !== null && m.score >= 0.82;
    })
    .map((l) => l.box);
  if (labelBoxes.length < 3) return [];

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of labelBoxes) {
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }

  const meta = await sharp(variantPath).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return [];
  // Only worth a second pass on large screenshots (a chart with a small panel).
  // Small images are order tickets/cards the full pass already reads well.
  if (W < 1100) return [];

  // If the labels already fill most of the frame, this is a plain order ticket,
  // not a small panel inside a chart — the full pass already read it well and a
  // re-crop would only add a noisier second read. Only re-OCR true corner panels.
  if (y1 - y0 > H * 0.65 || x1 - x0 > W * 0.7) return [];

  // Labels sit left of their values, so extend right to capture the value
  // column; extend left/vertically only a little. The chart (and its price
  // axis) sits left of the label column, so it stays excluded.
  const padY = (y1 - y0) * 0.15 + 24;
  const left = Math.max(0, Math.floor(x0 - W * 0.03));
  const right = Math.min(W, Math.ceil(x1 + W * 0.28));
  const top = Math.max(0, Math.floor(y0 - padY));
  const bottom = Math.min(H, Math.ceil(y1 + padY));
  const cw = right - left;
  const ch = bottom - top;
  if (cw < 60 || ch < 60) return [];
  // No benefit if the crop is essentially the whole image (already OCR'd well).
  if (cw > W * 0.9 && ch > H * 0.9) return [];

  const target = 1500;
  const scale = Math.max(1, Math.min(3, target / cw));
  const tmp = path.join(os.tmpdir(), `tj-ocr-roi-${randomUUID()}.png`);
  try {
    await sharp(variantPath)
      .extract({ left, top, width: cw, height: ch })
      .resize({ width: Math.round(cw * scale) })
      .sharpen()
      .png()
      .toFile(tmp);
    const roiLines = await paddleEngine.recognize(tmp);
    // Remap boxes from ROI-crop-local pixels back into the same "variant
    // space" the full pass's lines use, so downstream code (disabled-field
    // contrast sampling, layout) can treat all lines uniformly regardless of
    // which pass produced them.
    return roiLines.map((l) =>
      makeLine(l.text, l.confidence, {
        x0: left + l.box.x0 / scale,
        y0: top + l.box.y0 / scale,
        x1: left + l.box.x1 / scale,
        y1: top + l.box.y1 / scale,
      }),
    );
  } catch {
    return [];
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}
