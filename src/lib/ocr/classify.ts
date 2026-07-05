// Screenshot classification + broker detection. Both are keyword/heuristic
// based (no fixed positions) and feed the log and the semantic parser. The
// broker result is the extensibility seam: a profile can contribute extra
// label aliases without touching the core pipeline.

import type { Layout } from "./layout";
import type { ScreenshotType } from "./types";

export function classifyScreenshot(layout: Layout): ScreenshotType {
  const text = layout.texts.join(" \n ").toLowerCase();
  const rows = layout.rows();

  const has = (re: RegExp) => re.test(text);

  if (has(/\bpending\b|\bworking order\b|\bqueued\b/)) return "pending_order";
  if (has(/order confirmation|trade confirmation|confirmation|filled order/)) return "trade_confirmation";
  if (has(/\b(buy|sell)\b/) && has(/\b(limit|market|stop)\b/) && has(/\b(qty|quantity|shares|contracts|price)\b/) && rows.length <= 12) {
    return "order_ticket";
  }
  if (has(/unrealized|\bopen p\/?l\b|open position/)) return "open_position";
  if (has(/realized|closed p\/?l|closed position|\bclosed\b/)) return "closed_position";
  if (has(/portfolio|holdings|positions summary|watchlist/)) return "portfolio";
  if (has(/performance|equity curve|win rate|profit factor/)) return "performance" as ScreenshotType;
  // Many aligned rows with numbers → a history/trade table.
  if (rows.length >= 6 && rows.filter((r) => r.length >= 3).length >= 4) return "history";
  if (has(/\b(o|h|l|c)\b.*\bvol\b/) && !has(/entry|stop|target/)) return "chart";
  return "unknown";
}

interface BrokerProfile {
  name: string;
  match: RegExp;
}

// Lightweight registry. Adding a broker = adding a row (extensible by design).
const BROKERS: BrokerProfile[] = [
  { name: "TradingView", match: /tradingview|nasdaq:|binance:|\bcme:|\boanda:/i },
  { name: "MetaTrader", match: /metatrader|\bmt4\b|\bmt5\b|metaquotes/i },
  { name: "Interactive Brokers", match: /interactive brokers|\bibkr\b|\btws\b/i },
  { name: "thinkorswim", match: /thinkorswim|\btos\b|td ameritrade/i },
  { name: "Robinhood", match: /robinhood/i },
  { name: "Webull", match: /webull/i },
  { name: "TradeLocker", match: /tradelocker/i },
  { name: "Tradovate", match: /tradovate/i },
  { name: "NinjaTrader", match: /ninjatrader/i },
  { name: "Binance", match: /binance/i },
  { name: "Bybit", match: /bybit/i },
  { name: "Kraken", match: /kraken/i },
  { name: "Coinbase", match: /coinbase/i },
  { name: "KuCoin", match: /kucoin/i },
  { name: "MEXC", match: /mexc/i },
  { name: "Charles Schwab", match: /schwab/i },
  { name: "Fidelity", match: /fidelity/i },
  { name: "E*TRADE", match: /e\*?trade/i },
];

export function detectBroker(layout: Layout): string | null {
  const text = layout.texts.join(" ");
  for (const b of BROKERS) if (b.match.test(text)) return b.name;
  return null;
}
