import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Holds the colour tokens in src/app/globals.css to what they are for.
//
// Reads the stylesheet itself rather than a copy of its values, so the test
// cannot drift from what ships. Two jobs:
//
//  1. The palette is locked. Four redesigns were rejected in part for "the
//     colour palette is different again", so the existing tokens are pinned
//     here and a change to any of them fails loudly.
//  2. Every surface Phase 2A of docs/design-audit.md added carries text, and
//     the light-mode values were derived rather than given by the spec, so
//     each pairing is held to WCAG AA (4.5:1 for normal text).

const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

/** The declarations inside the first `<selector> {` block. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const light = block(":root");
const dark = block(".dark");

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

function hex(value: string): RGB {
  const h = value.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

/** The three colour syntaxes this file uses: #rrggbb, `rgb(r g b / a)`, and
 *  `color-mix(in srgb, #rrggbb N%, transparent)` -- the last is that colour
 *  at alpha N%. */
function parse(value: string): RGBA {
  if (value.startsWith("#")) return [...hex(value), 1];
  const rgb = value.match(/^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)$/);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], +rgb[4]];
  const mix = value.match(/^color-mix\(in srgb,\s*(#[0-9a-f]{6})\s+([\d.]+)%,\s*transparent\)$/i);
  if (mix) return [...hex(mix[1]), +mix[2] / 100];
  throw new Error(`unparsed colour: ${value}`);
}

/** Paint a possibly-translucent colour over an opaque one. */
function over(top: RGBA, base: RGB): RGB {
  const a = top[3];
  return [0, 1, 2].map((i) => Math.round(top[i] * a + base[i] * (1 - a))) as RGB;
}

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Tailwind v4 defines zinc in oklch; these are its sRGB renderings.
const ZINC = {
  50: hex("#fafafa"),
  400: hex("#9f9fa9"),
  600: hex("#52525c"),
  900: hex("#18181b"),
  950: hex("#09090b"),
};
const WHITE = hex("#ffffff");
const AA = 4.5;

describe("locked palette", () => {
  it("keeps every existing dark token at its production value", () => {
    expect(dark["--background"]).toBe("#101010");
    expect(dark["--foreground"]).toBe("#eceae4");
    expect(dark["--color-primary"]).toBe("#4d8ef7");
    expect(dark["--color-card"]).toBe("#1a1a19");
    expect(dark["--color-profit"]).toBe("#10b981");
    expect(dark["--color-loss"]).toBe("#f87171");
    expect(dark["--color-subtle"]).toBe("#2b2b28");
  });

  it("keeps every existing light token at its production value", () => {
    expect(light["--background"]).toBe("#ffffff");
    expect(light["--foreground"]).toBe("#1c1b18");
    expect(light["--color-primary"]).toBe("#2563eb");
    expect(light["--color-card"]).toBe("#fdfdfc");
    expect(light["--color-profit"]).toBe("#047857");
    expect(light["--color-loss"]).toBe("#dc2626");
    expect(light["--color-subtle"]).toBe("#e6e5df");
  });
});

describe("the spec's new tokens (Phase 2A)", () => {
  it("uses the spec's values in dark mode", () => {
    expect(dark["--band-cta"]).toBe("#0e1a2e");
    expect(dark["--color-primary-hover"]).toBe("#6aa2fa");
  });

  it("renders the see-through raised band within one step of #161615", () => {
    // Translucent so the dot lattice shows through; it still has to land on
    // the spec's colour once composited over the page.
    const band = over(parse(dark["--band-raised"]), hex(dark["--background"]));
    const target = hex("#161615");
    band.forEach((c, i) => expect(Math.abs(c - target[i])).toBeLessThanOrEqual(1));
  });

  it("keeps the raised band a real step off the base in both themes", () => {
    // A band nobody can see is not a band.
    for (const [theme, bg] of [
      [dark, hex(dark["--background"])],
      [light, hex(light["--background"])],
    ] as const) {
      const band = over(parse(theme["--band-raised"]), bg);
      expect(band).not.toEqual(bg);
    }
  });
});

describe("contrast on the new surfaces (WCAG AA)", () => {
  it("dark: page ink stays readable on a raised band", () => {
    const band = over(parse(dark["--band-raised"]), hex(dark["--background"]));
    expect(contrast(hex(dark["--foreground"]), band)).toBeGreaterThanOrEqual(AA);
    expect(contrast(ZINC[400], band)).toBeGreaterThanOrEqual(AA);
  });

  it("light: page ink stays readable on a raised band", () => {
    const band = over(parse(light["--band-raised"]), hex(light["--background"]));
    expect(contrast(hex(light["--foreground"]), band)).toBeGreaterThanOrEqual(AA);
    expect(contrast(ZINC[600], band)).toBeGreaterThanOrEqual(AA);
  });

  it("the closing CTA card keeps its text readable in both themes", () => {
    // Its heading is zinc-900 / zinc-50 and its paragraph zinc-600 / zinc-400,
    // unchanged by 2A -- only the card's fill moved to --band-cta.
    const darkCard = hex(dark["--band-cta"]);
    expect(contrast(ZINC[50], darkCard)).toBeGreaterThanOrEqual(AA);
    expect(contrast(ZINC[400], darkCard)).toBeGreaterThanOrEqual(AA);

    const lightCard = hex(light["--band-cta"]);
    expect(contrast(ZINC[900], lightCard)).toBeGreaterThanOrEqual(AA);
    expect(contrast(ZINC[600], lightCard)).toBeGreaterThanOrEqual(AA);
  });

  it("a hovered primary button keeps its label readable in both themes", () => {
    // Primary buttons are `text-white dark:text-zinc-950`.
    expect(contrast(WHITE, hex(light["--color-primary-hover"]))).toBeGreaterThanOrEqual(AA);
    expect(contrast(ZINC[950], hex(dark["--color-primary-hover"]))).toBeGreaterThanOrEqual(AA);
  });
});
