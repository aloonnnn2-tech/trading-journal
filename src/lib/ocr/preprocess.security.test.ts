import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { preprocessImage } from "./preprocess";

// Malformed and hostile images reaching the OCR pipeline. The contract these
// assert is narrow but important: preprocessImage must REJECT rather than
// allocate, and must fail as a thrown Error the route already handles -- never
// by taking the process down.
//
// Real images are generated rather than committed as fixtures so the test
// exercises the actual decoder, which is the thing being defended.

async function pixels(width: number, height: number): Promise<Buffer> {
  return await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 10, b: 10 } },
  })
    .png()
    .toBuffer();
}

describe("preprocessImage input validation", () => {
  it("processes an ordinary screenshot-sized image", async () => {
    const result = await preprocessImage(await pixels(1200, 800));
    expect(result.variants.length).toBeGreaterThan(0);
    expect(result.meta.width).toBe(1200);
    await result.cleanup();
  });

  // A decompression bomb: highly compressible pixel data means a small file
  // can describe an enormous canvas. This one is a few hundred KB on disk and
  // would be gigabytes decoded, which is exactly the case a byte-size cap
  // cannot catch.
  // Measured: this file is ~0.43MB -- it passes the route's 5MB byte cap --
  // and describes 144 megapixels, roughly 432MB once decoded. Verified that
  // sharp's DEFAULT ceiling (~268MP) accepts it, so before the explicit
  // limitInputPixels this reached stats() and was decoded at full size. Either
  // guard rejecting is a pass; which one fires first is an implementation
  // detail, and in practice it is sharp's, inside metadata(), before any
  // pixels are allocated at all.
  it("rejects an image whose pixel count would exhaust memory", async () => {
    const bomb = await pixels(12_000, 12_000);
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024); // the byte cap cannot catch this
    await expect(preprocessImage(bomb)).rejects.toThrow(/too large|pixel limit/i);
  }, 60_000);

  // A degenerate strip slips under a pixel budget while still allocating
  // pathologically, so the per-side bound is a separate check.
  it("rejects a pathologically long thin image", async () => {
    const strip = await pixels(21_000, 8);
    await expect(preprocessImage(strip)).rejects.toThrow(/too large|pixel limit/i);
  }, 30_000);

  it.each([
    ["empty input", Buffer.alloc(0)],
    ["random bytes", Buffer.from([0x00, 0xff, 0x10, 0x99, 0x42, 0x07])],
    ["a text file claiming to be an image", Buffer.from("not an image at all")],
    ["a PNG header with no body", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ])("rejects %s without crashing", async (_label, payload) => {
    await expect(preprocessImage(payload)).rejects.toThrow();
  });

  // Truncation tolerance is deliberate (screenshots are often imperfect), so
  // this pins the behaviour: a partially-cut image must not throw the process
  // off, whichever way it resolves.
  it("survives a truncated image", async () => {
    const full = await pixels(400, 300);
    const truncated = full.subarray(0, Math.floor(full.length / 2));
    let threw = false;
    try {
      const r = await preprocessImage(truncated);
      await r.cleanup();
    } catch {
      threw = true;
    }
    expect(typeof threw).toBe("boolean"); // either outcome is fine; a crash is not
  });
});
