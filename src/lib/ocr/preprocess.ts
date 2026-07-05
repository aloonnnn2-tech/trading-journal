// Image validation + preprocessing. Produces several candidate images tuned
// for OCR (contrast-normalized, sharpened, inverted for dark mode) and writes
// each to a temp file, because the PaddleOCR backend reads images by path.
// The caller runs OCR over the variants and keeps the best, then calls
// cleanup() to delete the temp files.

import sharp from "sharp";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface PreprocessVariant {
  name: string;
  path: string;
}

export interface Preprocessed {
  variants: PreprocessVariant[];
  // `scale` is the single resize factor applied uniformly to every variant
  // (relative to the original buffer). OCR line boxes come back in this
  // "variant space" — divide by `scale` to map a box back to original-image
  // pixel coordinates (used by disabled.ts to sample the source pixels).
  meta: { width: number; height: number; darkMode: boolean; scale: number };
  cleanup: () => Promise<void>;
}

const MAX_SIDE = 2200; // bound OCR time on huge screenshots
const MIN_SIDE = 1000; // upscale small/phone crops so small text is legible

function resizeScale(width: number, height: number): number {
  const longest = Math.max(width, height);
  if (longest > MAX_SIDE) return MAX_SIDE / longest;
  if (longest < MIN_SIDE) return Math.min(2, MIN_SIDE / longest);
  return 1;
}

/** Base pipeline shared by all variants: auto-orient + sane resize. */
function base(buffer: Buffer, width: number, height: number, scale: number): sharp.Sharp {
  let img = sharp(buffer, { failOn: "none" }).rotate(); // honor EXIF orientation
  if (scale !== 1) {
    img = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), fit: "fill" });
  }
  return img.flatten({ background: "#ffffff" });
}

export async function preprocessImage(buffer: Buffer): Promise<Preprocessed> {
  // Validation: unreadable images throw here and are handled by the pipeline.
  const meta = await sharp(buffer, { failOn: "none" }).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("Unreadable image");

  // Dark-mode detection from mean luminance.
  const stats = await sharp(buffer, { failOn: "none" }).greyscale().stats();
  const meanLuma = stats.channels[0]?.mean ?? 255;
  const darkMode = meanLuma < 110;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tj-ocr-"));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true }).catch(() => {});

  try {
    const variants: PreprocessVariant[] = [];

    const write = async (name: string, img: sharp.Sharp) => {
      const p = path.join(dir, `${name}-${randomUUID()}.png`);
      await img.png().toFile(p);
      variants.push({ name, path: p });
    };

    const scale = resizeScale(width, height);

    // Ordered by likely quality. Dark screenshots OCR best inverted, so lead with
    // it; the multi-pass runner stops early once a pass is confident.
    const build = () => base(buffer, width, height, scale);
    if (darkMode) {
      await write("inverted", build().negate({ alpha: false }).normalise());
      await write("contrast", build().greyscale().normalise());
    } else {
      await write("base", build());
      await write("contrast", build().greyscale().normalise());
      await write("sharpen", build().greyscale().sharpen());
    }

    return { variants, meta: { width, height, darkMode, scale }, cleanup };
  } catch (err) {
    // A write can throw partway through (a sharp operation faulting on an
    // unusual-but-valid image, a transient disk fault, ...). The caller never
    // receives this function's return value — and with it, never receives
    // `cleanup` — when we throw, so the already-created temp directory would
    // otherwise be orphaned on disk forever. Clean up here instead.
    await cleanup();
    throw err;
  }
}
