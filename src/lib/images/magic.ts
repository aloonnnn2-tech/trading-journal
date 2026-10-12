/**
 * What an image file actually is, read from its first bytes -- never from the
 * client's declared MIME type, which the browser (or a script) can set to
 * anything. Uploads and screenshot reads go by these bytes, not the claim
 * (security hardening, Phase 4).
 */

export type ImageKind = "jpeg" | "png" | "gif" | "webp";

export const MIME_BY_KIND: Record<ImageKind, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** The image format the bytes are, or null if none of the four we accept. */
export function detectImageKind(buf: Uint8Array): ImageKind | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(buf, ascii("GIF87a")) || startsWith(buf, ascii("GIF89a"))) return "gif";
  if (startsWith(buf, ascii("RIFF")) && startsWith(buf, ascii("WEBP"), 8)) return "webp";
  return null;
}
