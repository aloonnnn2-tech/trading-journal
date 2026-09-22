import type { Trade } from "./types";

/**
 * What the `entry_price` field is called, by order type and state.
 *
 * While an order rests, `entry_price` is the price the order is waiting at,
 * and that has a different name per order type -- calling a stop-limit's
 * trigger "Entry Price" is what made the trade card look as if it only asked
 * for the limit. Once filled it is simply the entry. Shared by the card and
 * the "still needs" checklist so the two never name the same box differently.
 */
export function entryPriceLabels(
  orderType: Trade["order_type"],
  pending: boolean,
): { entry: string; entryTip?: string } {
  if (!pending) return { entry: "Entry Price" };
  switch (orderType) {
    case "limit":
      return { entry: "Limit Price", entryTip: "The price the order is waiting at. Becomes the entry price when it fills." };
    case "stop":
      return {
        entry: "Stop Price",
        entryTip: "The level that triggers the order -- not your stop loss. Becomes the entry price when it fills.",
      };
    case "stop_limit":
      return {
        entry: "Stop Price (trigger)",
        entryTip:
          "The level that activates the order -- not your stop loss. After it is touched, the order rests as a limit at the Limit Price, which is where it fills.",
      };
    case "trailing_stop":
      return {
        entry: "Trigger Price",
        entryTip: "Where the trail currently sits. The app records trailing stops but never fills them automatically.",
      };
    default:
      return { entry: "Entry Price", entryTip: "The price the order is waiting at. Becomes the entry price when it fills." };
  }
}
