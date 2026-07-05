// Layout analysis over OCR lines. Works purely from bounding boxes — never
// fixed pixel positions — so it generalizes across brokers, resolutions, and
// crops. Provides the spatial queries the semantic parser needs: is this line
// a label, and where is its value (same row to the right, or the column below)?

import type { OcrLine } from "./types";
import { matchLabel } from "./labels";

/** Vertical overlap ratio of two lines (0..1), relative to the shorter one. */
function vOverlap(a: OcrLine, b: OcrLine): number {
  const top = Math.max(a.box.y0, b.box.y0);
  const bottom = Math.min(a.box.y1, b.box.y1);
  const inter = Math.max(0, bottom - top);
  return inter / Math.min(a.height, b.height);
}

export class Layout {
  readonly lines: OcrLine[];

  constructor(lines: OcrLine[]) {
    // Top-to-bottom, then left-to-right — the natural reading order.
    this.lines = [...lines].sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  }

  get texts(): string[] {
    return this.lines.map((l) => l.text);
  }

  /** Lines on the same visual row as `line` (excluding it), left to right. */
  sameRow(line: OcrLine): OcrLine[] {
    return this.lines
      .filter((l) => l !== line && vOverlap(l, line) >= 0.5)
      .sort((a, b) => a.box.x0 - b.box.x0);
  }

  /**
   * The value that belongs to a label line. Preference order mirrors how
   * brokers lay out label/value pairs:
   *   1. immediately to the right on the same row,
   *   2. the nearest line below whose left edge aligns with the label (a
   *      stacked "label over value" column).
   * `accept` decides whether a candidate's text is a usable value.
   */
  valueFor(label: OcrLine, accept: (line: OcrLine) => boolean): OcrLine | null {
    // 1. Same row, to the right of the label.
    const right = this.sameRow(label)
      .filter((l) => l.box.x0 >= label.box.x1 - label.height * 0.5)
      .find(accept);
    if (right) return right;

    // 2. Column below: aligned left edges, closest first, within a few rows.
    // Stop at the next recognized label rather than walking past it — if this
    // label's own value is missing (an OCR miss), the correct outcome is no
    // value found, not silently grabbing the next field's value instead.
    const tol = Math.max(label.height * 1.5, 24);
    const below = this.lines
      .filter(
        (l) =>
          l.box.y0 > label.box.y1 - label.height * 0.3 &&
          l.box.y0 - label.box.y1 < label.height * 6 &&
          Math.abs(l.box.x0 - label.box.x0) <= tol,
      )
      .sort((a, b) => a.box.y0 - b.box.y0);
    for (const l of below) {
      if (accept(l)) return l;
      if (l !== label && matchLabel(l.text)) return null;
    }
    return null;
  }

  /** Group lines into rows (for table-like screenshots / classification). */
  rows(): OcrLine[][] {
    const rows: OcrLine[][] = [];
    for (const line of this.lines) {
      const row = rows.find((r) => vOverlap(r[0], line) >= 0.5);
      if (row) row.push(line);
      else rows.push([line]);
    }
    for (const r of rows) r.sort((a, b) => a.box.x0 - b.box.x0);
    return rows;
  }
}
