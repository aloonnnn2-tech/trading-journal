// What the page ground is on /home-v2. Each variant is a full-page layer
// painted behind everything; none of them changes the page's height. Plain
// module (no "use client") so the route file can validate `?bg=` on the
// server.

export const BG_VARIANTS = ["plain", "grid", "dots", "chart", "noise", "tint", "beams"] as const;
export type BgVariant = (typeof BG_VARIANTS)[number];

export function isBgVariant(value: unknown): value is BgVariant {
  return typeof value === "string" && (BG_VARIANTS as readonly string[]).includes(value);
}
