import type { FeeComponent } from "./types";

// Researched broker fee presets for Setup -> Commissions (Alon, 2026-09-29).
//
// THE RULE (docs/design-audit.md): never show a number that isn't true. Every
// figure below was read on the broker's own pricing page, help centre, fee
// schedule or official blog on CHECKED_ON, and `source` links to it. Brokers
// change prices -- a preset is a starting point the user edits, the UI says
// when it was checked, and nothing here is presented as live.
//
// Deliberately left out because the figure couldn't be confirmed at the
// source on that date: Lightspeed (base tier unclear on its page), Kraken
// (tiers changed 2026-07-09; the new table didn't render), Saxo, moomoo, and
// Israeli banks/brokers (no checkable public schedule -- the Custom
// "% with a minimum" template covers them).
//
// Units: amounts are per side (per fill), in the account's currency. For
// options and futures, "per_unit" means per contract -- log contracts in
// Shares. Exchange, clearing and NFA fees on futures vary by product and are
// NOT included; each futures preset says so.

export const CHECKED_ON = "2026-09-29";

export type PresetCategory = "us-stocks" | "options" | "futures" | "global" | "crypto";

export const PRESET_CATEGORY_LABELS: Record<PresetCategory, string> = {
  "us-stocks": "US stocks & ETFs",
  options: "Options",
  futures: "Futures",
  global: "Europe & global apps",
  crypto: "Crypto",
};

export interface BrokerPreset {
  id: string;
  broker: string;
  /** The plan or product this covers, shown after the broker name. */
  plan: string;
  category: PresetCategory;
  /** Suggested scope; the user can change it before saving. null = any trade. */
  asset_type: string | null;
  components: FeeComponent[];
  /** One line on what is and isn't included. */
  note?: string;
  source: string;
}

// ---- US regulatory fees, passed through on sells -------------------------
// SEC Section 31: $20.60 per $1M of sale value since 2026-04-04 (SEC fee
// rate advisory; IBKR and Webull list $0.0000206 x value of sales).
const SEC_FEE: FeeComponent = { label: "SEC fee", basis: "percent", amount: 0.00206, side: "sell" };
// FINRA TAF on equity sells: $0.000195/share, max $9.79 per trade (2026).
const FINRA_TAF: FeeComponent = { label: "FINRA TAF", basis: "per_unit", amount: 0.000195, side: "sell", max_fee: 9.79 };
// FINRA CAT fee on every fill: $0.000003/share (IBKR, Webull fee pages).
const CAT_FEE: FeeComponent = { label: "CAT fee", basis: "per_unit", amount: 0.000003, side: "both" };
// OCC clearing fee on options: $0.025/contract (IBKR, TradeStation).
const OCC_FEE: FeeComponent = { label: "OCC clearing", basis: "per_unit", amount: 0.025, side: "both" };

const commission = (c: Omit<FeeComponent, "label" | "side"> & { side?: FeeComponent["side"]; label?: string }): FeeComponent => ({
  ...c,
  label: c.label ?? "Commission",
  side: c.side ?? "both",
});

const IBKR_STOCKS = "https://www.interactivebrokers.com/en/pricing/commissions-stocks.php";
const IBKR_OPTIONS = "https://www.interactivebrokers.com/en/pricing/commissions-options.php";
const IBKR_FUTURES = "https://www.interactivebrokers.com/en/pricing/commissions-futures.php";
const TRADESTATION = "https://www.tradestation.com/pricing/";
const TASTYTRADE = "https://tastytrade.com/pricing/";
const NINJATRADER = "https://ninjatrader.com/pricing/";
const ETRADE = "https://us.etrade.com/what-we-offer/pricing-and-rates";

export const BROKER_PRESETS: BrokerPreset[] = [
  // ---- US stocks & ETFs ----------------------------------------------------
  {
    id: "ibkr-pro-fixed-stocks",
    broker: "Interactive Brokers",
    plan: "IBKR Pro Fixed — US stocks",
    category: "us-stocks",
    asset_type: null,
    components: [commission({ basis: "per_unit", amount: 0.005, min_fee: 1, max_percent: 1 }), SEC_FEE, FINRA_TAF, CAT_FEE],
    note: "$0.005/share, $1 minimum, capped at 1% of trade value; exchange fees included, regulatory fees passed through.",
    source: IBKR_STOCKS,
  },
  {
    id: "ibkr-pro-tiered-stocks",
    broker: "Interactive Brokers",
    plan: "IBKR Pro Tiered — US stocks (≤300,000 shares/month)",
    category: "us-stocks",
    asset_type: null,
    components: [
      commission({ basis: "per_unit", amount: 0.0035, min_fee: 0.35, max_percent: 1 }),
      { label: "Clearing (NSCC/DTC)", basis: "per_unit", amount: 0.0002, side: "both" },
      SEC_FEE,
      FINRA_TAF,
      CAT_FEE,
    ],
    note: "Exchange fees and rebates vary by venue and are not included.",
    source: IBKR_STOCKS,
  },
  {
    id: "ibkr-lite-stocks",
    broker: "Interactive Brokers",
    plan: "IBKR Lite — US stocks",
    category: "us-stocks",
    asset_type: null,
    components: [SEC_FEE, FINRA_TAF, CAT_FEE],
    note: "$0 commission; regulatory fees only.",
    source: IBKR_STOCKS,
  },
  {
    id: "schwab-stocks",
    broker: "Charles Schwab",
    plan: "Online US stocks & ETFs",
    category: "us-stocks",
    asset_type: null,
    components: [SEC_FEE],
    note: "$0 commission; the SEC fee on sells.",
    source: "https://www.schwab.com/pricing",
  },
  {
    id: "fidelity-stocks",
    broker: "Fidelity",
    plan: "Online US stocks & ETFs",
    category: "us-stocks",
    asset_type: null,
    components: [SEC_FEE],
    note: "$0 commission; the SEC fee on sells.",
    source: "https://www.fidelity.com/trading/commissions-margin-rates",
  },
  {
    id: "etrade-stocks",
    broker: "E*TRADE",
    plan: "Online US stocks & ETFs",
    category: "us-stocks",
    asset_type: null,
    components: [SEC_FEE],
    note: "$0 commission; the SEC fee on sells.",
    source: ETRADE,
  },
  {
    id: "robinhood-stocks",
    broker: "Robinhood",
    plan: "US stocks & ETFs",
    category: "us-stocks",
    asset_type: null,
    components: [SEC_FEE, FINRA_TAF],
    note: "$0 commission; SEC fee and FINRA TAF on sells.",
    source: "https://cdn.robinhood.com/assets/robinhood/legal/RHF+Fee+Schedule.pdf",
  },
  {
    id: "webull-stocks",
    broker: "Webull",
    plan: "US stocks & ETFs",
    category: "us-stocks",
    asset_type: null,
    components: [SEC_FEE, FINRA_TAF, CAT_FEE],
    note: "$0 commission; SEC fee and FINRA TAF on sells, CAT fee on every fill.",
    source: "https://www.webull.com/pricing",
  },
  {
    id: "firstrade-stocks",
    broker: "Firstrade",
    plan: "US stocks & ETFs",
    category: "us-stocks",
    asset_type: null,
    components: [SEC_FEE],
    note: "$0 commission; the SEC fee on sells.",
    source: "https://www.firstrade.com/trading/pricing",
  },
  {
    id: "tradestation-stocks",
    broker: "TradeStation",
    plan: "US stocks & ETFs",
    category: "us-stocks",
    asset_type: null,
    components: [SEC_FEE],
    note: "$0 commission (sub-dollar and OTC stocks are $0.005/share -- add a line if you trade them).",
    source: TRADESTATION,
  },
  {
    id: "tradezero-paid-orders",
    broker: "TradeZero",
    plan: "Market & marketable limit orders",
    category: "us-stocks",
    asset_type: null,
    components: [commission({ basis: "per_unit", amount: 0.005, min_fee: 0.49 }), SEC_FEE, FINRA_TAF],
    note: "$0.005/share, $0.49 minimum. Non-marketable limit orders are free -- use the next preset for those.",
    source: "https://tradezero.com/pricing-and-fees",
  },
  {
    id: "tradezero-free-limit",
    broker: "TradeZero",
    plan: "Free (non-marketable) limit orders",
    category: "us-stocks",
    asset_type: null,
    components: [SEC_FEE, FINRA_TAF],
    note: "$0 commission; regulatory fees only.",
    source: "https://tradezero.com/pricing-and-fees",
  },
  {
    id: "tastytrade-stocks",
    broker: "tastytrade",
    plan: "Stocks & ETFs",
    category: "us-stocks",
    asset_type: null,
    components: [SEC_FEE],
    note: "$0 to open and close; the SEC fee on sells.",
    source: TASTYTRADE,
  },

  // ---- Options (log contracts as Shares) ---------------------------------
  {
    id: "ibkr-pro-options",
    broker: "Interactive Brokers",
    plan: "IBKR Pro — US options (premium ≥ $0.10)",
    category: "options",
    asset_type: "Option",
    components: [commission({ basis: "per_unit", amount: 0.65, min_fee: 1 }), OCC_FEE],
    note: "$0.65/contract, $1 minimum per order (≤10,000 contracts/month). Cheaper premiums: $0.50 below $0.10, $0.25 below $0.05.",
    source: IBKR_OPTIONS,
  },
  {
    id: "schwab-options",
    broker: "Charles Schwab",
    plan: "Options",
    category: "options",
    asset_type: "Option",
    components: [commission({ basis: "per_unit", amount: 0.65 })],
    note: "$0 base + $0.65 per contract.",
    source: "https://www.schwab.com/pricing",
  },
  {
    id: "fidelity-options",
    broker: "Fidelity",
    plan: "Options",
    category: "options",
    asset_type: "Option",
    components: [commission({ basis: "per_unit", amount: 0.65 })],
    note: "$0.65 per contract.",
    source: "https://www.fidelity.com/trading/commissions-margin-rates",
  },
  {
    id: "etrade-options",
    broker: "E*TRADE",
    plan: "Options",
    category: "options",
    asset_type: "Option",
    components: [commission({ basis: "per_unit", amount: 0.65 })],
    note: "$0.65 per contract; $0.50 with 30+ trades a quarter.",
    source: ETRADE,
  },
  {
    id: "tradestation-options",
    broker: "TradeStation",
    plan: "Options (0–500 contracts/month)",
    category: "options",
    asset_type: "Option",
    components: [commission({ basis: "per_unit", amount: 0.8 }), OCC_FEE],
    note: "$0.80 per contract per side at the lowest volume tier.",
    source: TRADESTATION,
  },
  {
    id: "tastytrade-options",
    broker: "tastytrade",
    plan: "Stock & ETF options",
    category: "options",
    asset_type: "Option",
    components: [commission({ label: "Opening commission", basis: "per_unit", amount: 1, max_fee: 10, side: "entry" })],
    note: "$1 per contract to open, $10 max per leg; $0 to close.",
    source: TASTYTRADE,
  },
  {
    id: "tradezero-options",
    broker: "TradeZero",
    plan: "Options",
    category: "options",
    asset_type: "Option",
    components: [commission({ label: "Contract fee", basis: "per_unit", amount: 0.59 })],
    note: "$0 commission + $0.59 per contract.",
    source: "https://tradezero.com/pricing-and-fees",
  },
  {
    id: "webull-options",
    broker: "Webull",
    plan: "Equity options",
    category: "options",
    asset_type: "Option",
    components: [],
    note: "$0 commission on US-listed stock options (index options are $0.50/contract).",
    source: "https://www.webull.com/pricing",
  },
  {
    id: "firstrade-options",
    broker: "Firstrade",
    plan: "Options",
    category: "options",
    asset_type: "Option",
    components: [],
    note: "$0 commission and $0 contract fee.",
    source: "https://www.firstrade.com/trading/pricing",
  },

  // ---- Futures (per contract per side; exchange/NFA fees extra) -----------
  {
    id: "ibkr-futures",
    broker: "Interactive Brokers",
    plan: "US futures (≤1,000 contracts/month)",
    category: "futures",
    asset_type: "Future",
    components: [commission({ basis: "per_unit", amount: 0.85 })],
    note: "$0.85 per contract per side. Exchange and regulatory fees are extra and vary by product.",
    source: IBKR_FUTURES,
  },
  {
    id: "ninjatrader-free-standard",
    broker: "NinjaTrader",
    plan: "Free plan — standard contracts",
    category: "futures",
    asset_type: "Future",
    components: [commission({ basis: "per_unit", amount: 1.29 })],
    note: "$1.29 per side. Exchange, clearing and NFA fees are extra.",
    source: NINJATRADER,
  },
  {
    id: "ninjatrader-free-micro",
    broker: "NinjaTrader",
    plan: "Free plan — micro contracts",
    category: "futures",
    asset_type: "Future",
    components: [commission({ basis: "per_unit", amount: 0.39 })],
    note: "$0.39 per side. Exchange, clearing and NFA fees are extra.",
    source: NINJATRADER,
  },
  {
    id: "tradestation-futures",
    broker: "TradeStation",
    plan: "Futures (0–500 contracts/month)",
    category: "futures",
    asset_type: "Future",
    components: [
      commission({ basis: "per_unit", amount: 1.75 }),
      { label: "Clearing", basis: "per_unit", amount: 0.1, side: "both" },
    ],
    note: "$1.75 + $0.10 clearing per contract per side. Exchange and NFA fees extra.",
    source: TRADESTATION,
  },
  {
    id: "tradestation-micro-futures",
    broker: "TradeStation",
    plan: "Micro futures (0–500 contracts/month)",
    category: "futures",
    asset_type: "Future",
    components: [
      commission({ basis: "per_unit", amount: 0.5 }),
      { label: "Clearing", basis: "per_unit", amount: 0.1, side: "both" },
    ],
    note: "$0.50 + $0.10 clearing per contract per side. Exchange and NFA fees extra.",
    source: TRADESTATION,
  },
  {
    id: "tastytrade-futures",
    broker: "tastytrade",
    plan: "Futures",
    category: "futures",
    asset_type: "Future",
    components: [commission({ basis: "per_unit", amount: 1 })],
    note: "$1 per contract to open and to close (micros $0.75). Exchange fees extra.",
    source: TASTYTRADE,
  },
  {
    id: "etrade-futures",
    broker: "E*TRADE",
    plan: "Futures",
    category: "futures",
    asset_type: "Future",
    components: [commission({ basis: "per_unit", amount: 1.5 })],
    note: "$1.50 per contract per side, plus exchange and NFA fees.",
    source: ETRADE,
  },

  // ---- Europe & global apps -------------------------------------------------
  {
    id: "trading212-invest",
    broker: "Trading 212",
    plan: "Invest / ISA — foreign-currency stocks",
    category: "global",
    asset_type: null,
    components: [{ label: "FX fee", basis: "percent", amount: 0.15, side: "both" }],
    note: "Commission-free; 0.15% FX fee only when the stock's currency differs from your account's.",
    source: "https://helpcentre.trading212.com/hc/en-us/articles/360018909758-What-is-the-FX-fee-Invest-Stocks-ISA",
  },
  {
    id: "degiro-us-stocks",
    broker: "DEGIRO",
    plan: "US stocks (with AutoFX)",
    category: "global",
    asset_type: null,
    components: [
      commission({ label: "Commission + handling", basis: "flat", amount: 2 }),
      { label: "AutoFX", basis: "percent", amount: 0.25, side: "both" },
    ],
    note: "€1 commission + €1 handling fee per order; 0.25% AutoFX when converting currency.",
    source: "https://www.degiro.com/uk/fees",
  },
  {
    id: "etoro-stocks",
    broker: "eToro",
    plan: "Stocks",
    category: "global",
    asset_type: null,
    components: [commission({ basis: "flat", amount: 1 })],
    note: "$1 per open and close; $2 in some countries and exchanges -- edit if yours is $2. Conversion fee extra if currencies differ.",
    source: "https://help.etoro.com/s/article/which-fees-and-commissions-does-etoro-have?language=en_GB",
  },
  {
    id: "xtb-stocks",
    broker: "XTB",
    plan: "Stocks & ETFs, foreign currency",
    category: "global",
    asset_type: null,
    components: [{ label: "Currency conversion", basis: "percent", amount: 0.5, side: "both" }],
    note: "0% commission up to €100,000 a month (then 0.2%, min €10); 0.5% currency conversion.",
    source: "https://www.xtb.com/int/help-center/fees-and-payments-1/do-you-charge-commissions-1",
  },

  // ---- Crypto ---------------------------------------------------------------
  {
    id: "binance-spot",
    broker: "Binance",
    plan: "Spot (regular user)",
    category: "crypto",
    asset_type: "Crypto",
    components: [{ label: "Trading fee", basis: "percent", amount: 0.1, side: "both" }],
    note: "0.1% maker and taker; 25% less when paying fees in BNB (0.075%).",
    source: "https://www.binance.com/en/fee/schedule",
  },
  {
    id: "coinbase-advanced-us-taker",
    broker: "Coinbase Advanced",
    plan: "US, entry tier — taker (market orders)",
    category: "crypto",
    asset_type: "Crypto",
    components: [{ label: "Taker fee", basis: "percent", amount: 0.9, side: "both" }],
    note: "0.90% taker; limit orders that rest on the book pay 0.50% maker.",
    source: "https://www.coinbase.com/blog/were-lowering-fees-for-many-active-traders-on-coinbase-advanced",
  },
  {
    id: "coinbase-advanced-us-maker",
    broker: "Coinbase Advanced",
    plan: "US, entry tier — maker (resting limit orders)",
    category: "crypto",
    asset_type: "Crypto",
    components: [{ label: "Maker fee", basis: "percent", amount: 0.5, side: "both" }],
    source: "https://www.coinbase.com/blog/were-lowering-fees-for-many-active-traders-on-coinbase-advanced",
  },
  {
    id: "coinbase-advanced-eu-taker",
    broker: "Coinbase Advanced",
    plan: "EU & UK, entry tier — taker",
    category: "crypto",
    asset_type: "Crypto",
    components: [{ label: "Taker fee", basis: "percent", amount: 0.5, side: "both" }],
    note: "0.50% taker; resting limit orders pay 0.25% maker.",
    source: "https://www.coinbase.com/blog/were-lowering-fees-for-many-active-traders-on-coinbase-advanced",
  },
  {
    id: "etoro-crypto",
    broker: "eToro",
    plan: "Crypto",
    category: "crypto",
    asset_type: "Crypto",
    components: [{ label: "Crypto fee", basis: "percent", amount: 1, side: "both" }],
    note: "1% on each buy and sell (lower tiers for Platinum and above).",
    source: "https://help.etoro.com/s/article/which-fees-and-commissions-does-etoro-have?language=en_GB",
  },
  {
    id: "etrade-crypto",
    broker: "E*TRADE",
    plan: "Crypto",
    category: "crypto",
    asset_type: "Crypto",
    components: [{ label: "Crypto fee", basis: "percent", amount: 0.5, side: "both" }],
    note: "0.50% on the dollar value of each trade.",
    source: ETRADE,
  },
];

/** Templates for anything not listed: the user fills in their own numbers. */
export const CUSTOM_TEMPLATES: { id: string; name: string; hint: string; components: FeeComponent[] }[] = [
  {
    id: "custom-flat",
    name: "Flat fee per order",
    hint: "The same amount on every buy and sell -- e.g. $2.50 a side.",
    components: [{ label: "Commission", basis: "flat", amount: 0, side: "both" }],
  },
  {
    id: "custom-percent-min",
    name: "% of trade value with a minimum",
    hint: "How most banks (including Israeli banks) and many European brokers charge.",
    components: [{ label: "Commission", basis: "percent", amount: 0, side: "both", min_fee: 0 }],
  },
  {
    id: "custom-per-share",
    name: "Per share with a minimum",
    hint: "How direct-access day-trading brokers usually charge.",
    components: [{ label: "Commission", basis: "per_unit", amount: 0, side: "both", min_fee: 0 }],
  },
];

export function findPreset(id: string | null | undefined): BrokerPreset | undefined {
  return id ? BROKER_PRESETS.find((p) => p.id === id) : undefined;
}
