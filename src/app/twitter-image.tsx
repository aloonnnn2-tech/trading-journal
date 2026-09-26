import { renderShareCard } from "./_og/share-card";

// The link-preview image for every route below the app root. Declared
// literally rather than re-exported from ./_og/share-card: Next reads these
// three at build time and wants them statically in this file. Keep them in
// step with SHARE_CARD_SIZE and SHARE_CARD_ALT there.
export const alt = "Trading Lens. Free, no credit card. See the pattern behind every trade.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return renderShareCard();
}
