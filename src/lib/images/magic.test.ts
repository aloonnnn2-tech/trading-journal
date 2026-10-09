import { describe, expect, it } from "vitest";
import { detectImageKind } from "./magic";

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? Array.from(p, (c) => c.charCodeAt(0)) : p)));

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const GIF = bytes("GIF89a", [1, 0, 1, 0]);
const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ");
const SVG = bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const HTML = bytes("<!doctype html><script>alert(1)</script>");

describe("detectImageKind", () => {
  it("recognises the four accepted formats by their signatures", () => {
    expect(detectImageKind(JPEG)).toBe("jpeg");
    expect(detectImageKind(PNG)).toBe("png");
    expect(detectImageKind(GIF)).toBe("gif");
    expect(detectImageKind(bytes("GIF87a"))).toBe("gif");
    expect(detectImageKind(WEBP)).toBe("webp");
  });

  it("rejects SVG, HTML, empty and truncated input", () => {
    expect(detectImageKind(SVG)).toBeNull();
    expect(detectImageKind(HTML)).toBeNull();
    expect(detectImageKind(new Uint8Array())).toBeNull();
    expect(detectImageKind(bytes([0xff, 0xd8]))).toBeNull();
    expect(detectImageKind(bytes("RIFF", [0, 0, 0, 0], "WAVE"))).toBeNull();
  });
});
