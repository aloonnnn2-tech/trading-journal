// Builds the public DEMO ACCOUNT: a journal that looks like somebody has been
// trading out of it every day for the better part of a year, rather than the
// thin "does the UI render?" fixture scripts/seed-fake-data.mjs produces.
//
// What it covers, and why each piece is here:
//   - ~10 months of near-daily sessions, so the calendar, streaks and the
//     equity curve all have something continuous to draw.
//   - A cash ledger (deposits + one withdrawal), so account balance and
//     risk-% figures are anchored to a real starting stake instead of
//     floating.
//   - Strategies WITH plan rules, so /strategies and the plan-adherence panel
//     are populated and some trades genuinely break their own rules.
//   - Deliberate, consistent biases (calm > FOMO, mornings > late day,
//     Tuesday > Friday, oversized = worse) so /insights and the edge finder
//     have real signal to detect rather than noise.
//   - Edit history on some trades, so "stop was moved" is detectable the only
//     way the app can detect it (0008 snapshots).
//   - MAE/MFE rows, so the excursion + capture-ratio panels aren't empty.
//   - Stored AI reviews whose numbers are computed from the seeded trades, so
//     nothing in them contradicts what the rest of the app shows.
//
// Everything is written with the service-role key: the demo user's rows are
// created directly rather than through the app, and user_settings.plan is
// deliberately not grantable to the user themselves (see 0029).
//
// Deterministic: the same --seed produces the same journal, so a re-run after
// a schema change gives a comparable account rather than a new random one.
//
// Usage:
//   node scripts/seed-demo-account.mjs
//   node scripts/seed-demo-account.mjs --email=demo@example.com --password=... --days=300
//
// Re-running against an existing demo account WIPES that account's journal
// rows first (trades, strategies, folders, reviews, ledger) and reseeds them.
// It never touches any other user.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------- config ---

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

const EMAIL = args.email ?? "demo@tradinglens.app";
const PASSWORD = args.password ?? "TradingLens2026!";
const DAYS = Number(args.days ?? 300);
const SEED = Number(args.seed ?? 20260902);
const TIMEZONE = "America/New_York";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ------------------------------------------------------------- utilities ---

// mulberry32: small, seedable, good enough for fixture data and -- unlike
// Math.random -- reproducible, which is what makes a re-run comparable.
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rng = makeRng(SEED);
const resetRng = (seed) => { rng = makeRng(seed); };
const rand = () => rng();
const randBetween = (lo, hi) => lo + rand() * (hi - lo);
const randInt = (lo, hi) => Math.floor(randBetween(lo, hi + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

/** Weighted pick: entries are [value, weight]. */
function weightedPick(entries) {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rand() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** YYYY-MM-DD for a timestamp, read in UTC. Sessions are generated inside the
 *  US cash session (13:30-20:00 UTC), where the UTC day and the New York day
 *  are the same day -- so this is also the trader's local calendar day. */
function dayString(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

const iso = (ms) => new Date(ms).toISOString();

// -------------------------------------------------------------- universe ---

const UNIVERSE = [
  { ticker: "AAPL", company: "Apple Inc.", market: "NASDAQ", assetType: "Stock", price: 214, vol: 0.013, weight: 10 },
  { ticker: "MSFT", company: "Microsoft Corp.", market: "NASDAQ", assetType: "Stock", price: 418, vol: 0.012, weight: 9 },
  { ticker: "NVDA", company: "NVIDIA Corp.", market: "NASDAQ", assetType: "Stock", price: 126, vol: 0.026, weight: 14 },
  { ticker: "TSLA", company: "Tesla Inc.", market: "NASDAQ", assetType: "Stock", price: 244, vol: 0.03, weight: 12 },
  { ticker: "AMD", company: "Advanced Micro Devices", market: "NASDAQ", assetType: "Stock", price: 152, vol: 0.025, weight: 9 },
  { ticker: "META", company: "Meta Platforms", market: "NASDAQ", assetType: "Stock", price: 508, vol: 0.018, weight: 7 },
  { ticker: "AMZN", company: "Amazon.com Inc.", market: "NASDAQ", assetType: "Stock", price: 186, vol: 0.016, weight: 7 },
  { ticker: "SPY", company: "SPDR S&P 500 ETF", market: "NYSE", assetType: "ETF", price: 556, vol: 0.008, weight: 8 },
  { ticker: "QQQ", company: "Invesco QQQ Trust", market: "NASDAQ", assetType: "ETF", price: 478, vol: 0.01, weight: 6 },
  { ticker: "COIN", company: "Coinbase Global", market: "NASDAQ", assetType: "Stock", price: 218, vol: 0.035, weight: 5 },
  { ticker: "PLTR", company: "Palantir Technologies", market: "NASDAQ", assetType: "Stock", price: 33, vol: 0.03, weight: 5 },
  { ticker: "SMCI", company: "Super Micro Computer", market: "NASDAQ", assetType: "Stock", price: 46, vol: 0.042, weight: 4 },
  { ticker: "BTCUSD", company: null, market: "Crypto", assetType: "Crypto", price: 61500, vol: 0.026, weight: 5 },
  { ticker: "ETHUSD", company: null, market: "Crypto", assetType: "Crypto", price: 3350, vol: 0.032, weight: 3 },
];

const BY_TICKER = Object.fromEntries(UNIVERSE.map((u) => [u.ticker, u]));
const STOCK_TICKERS = UNIVERSE.filter((u) => u.assetType !== "Crypto");
const CRYPTO_TICKERS = UNIVERSE.filter((u) => u.assetType === "Crypto");

// Live-ish prices: a random walk per symbol, stepped once per calendar day, so
// the same ticker is priced consistently across the whole journal instead of
// jumping between $20 and $400 from one trade to the next.
const priceBook = Object.fromEntries(UNIVERSE.map((u) => [u.ticker, u.price]));
function resetPrices() {
  for (const u of UNIVERSE) priceBook[u.ticker] = u.price;
}
function stepPrices(dayIndex) {
  for (const u of UNIVERSE) {
    // Mild upward drift; a rough market backdrop rather than a simulation.
    const drift = 0.0006 + Math.sin(dayIndex / 40) * 0.0012;
    const shock = (rand() - 0.5) * 2 * u.vol;
    priceBook[u.ticker] = Math.max(u.price * 0.35, priceBook[u.ticker] * (1 + drift + shock));
  }
}

// ------------------------------------------------------------ strategies ---

// winRate / winR are the shape of each strategy's edge. They are chosen so the
// journal has a clear best AND a clear worst -- an account where everything
// works teaches the demo viewer nothing and makes /insights look inert.
// The journal's outcomes sit on a feedback loop -- a loss makes the next entry
// more likely to be logged as FOMO and oversized, which makes it more likely to
// lose in turn -- so a hand-picked edge constant that produced a credible
// account on one date produces a 44%-win-rate slide on another. The edge is
// therefore CALIBRATED, not fixed: the journal is generated across a range of
// values and the run landing closest to a believable profile is kept. That is
// what makes this script safe to re-run months from now.
const TARGET_RETURN = 0.3;
const EDGE_CANDIDATES = [-0.05, -0.04, -0.03, -0.025, -0.02, -0.015, -0.01, 0, 0.01, 0.02];

const STRATEGY_DEFS = [
  {
    name: "Opening Range Breakout",
    color: "#22c55e",
    description:
      "First 15-minute range on a gapping large cap. Enter on the break with volume expansion, stop under the range, first target 1.5R.",
    style: "intraday",
    weight: 26,
    winRate: 0.57,
    winR: 1.15,
    stopPct: [0.006, 0.014],
    plannedR: [1.5, 2.5],
    tickers: ["NVDA", "TSLA", "AMD", "AAPL", "SPY", "QQQ", "SMCI"],
  },
  {
    name: "Trend Pullback",
    color: "#3b82f6",
    description:
      "Buy the first controlled pullback to the 20 EMA in an established uptrend. No entry unless the higher timeframe trend is intact.",
    style: "swing",
    weight: 22,
    winRate: 0.52,
    winR: 1.35,
    stopPct: [0.015, 0.03],
    plannedR: [2, 3],
    tickers: ["MSFT", "AAPL", "META", "AMZN", "SPY", "NVDA", "QQQ"],
  },
  {
    name: "VWAP Reclaim",
    color: "#a855f7",
    description:
      "Failed breakdown that reclaims VWAP on rising volume. Stop below the reclaim low, out by the close either way.",
    style: "intraday",
    weight: 16,
    winRate: 0.54,
    winR: 1.0,
    stopPct: [0.005, 0.011],
    plannedR: [1.5, 2],
    tickers: ["TSLA", "AMD", "PLTR", "COIN", "SMCI", "NVDA"],
  },
  {
    name: "Swing Momentum",
    color: "#14b8a6",
    description:
      "Multi-day continuation after a high-volume breakout from a base. Held 3-8 sessions, trailed under the prior day's low.",
    style: "swing",
    weight: 12,
    winRate: 0.45,
    winR: 1.45,
    stopPct: [0.025, 0.05],
    plannedR: [2.5, 4],
    tickers: ["PLTR", "SMCI", "COIN", "NVDA", "AMD", "META"],
  },
  {
    name: "Crypto Breakout",
    color: "#f97316",
    description:
      "Range expansion on BTC/ETH out of a multi-day consolidation. Sized smaller than equities because the stop has to be wider.",
    style: "swing",
    weight: 8,
    winRate: 0.48,
    winR: 1.15,
    stopPct: [0.02, 0.045],
    plannedR: [2, 3],
    tickers: ["BTCUSD", "ETHUSD"],
  },
  {
    name: "Earnings Gap Fade",
    color: "#f59e0b",
    description:
      "Fade an over-extended earnings gap back toward the prior close. Kept deliberately small - lowest conviction setup in the plan.",
    style: "intraday",
    weight: 13,
    winRate: 0.44,
    winR: 1.0,
    stopPct: [0.008, 0.02],
    plannedR: [1.5, 2.5],
    tickers: ["TSLA", "META", "AMZN", "COIN", "SMCI", "PLTR"],
  },
  {
    name: "Range Reversal",
    color: "#ef4444",
    description:
      "Counter-trend fade at the top or bottom of an intraday range. Only with a clear rejection wick and only once per session.",
    style: "intraday",
    weight: 11,
    winRate: 0.38,
    winR: 1.15,
    stopPct: [0.006, 0.015],
    plannedR: [1.5, 2.5],
    tickers: ["SPY", "QQQ", "AAPL", "TSLA", "AMD"],
  },
];

// Plan rules per strategy. Written as the trader's own plan, which means some
// seeded trades break them -- that is what makes the adherence panel worth
// looking at.
const RULES_BY_STRATEGY = {
  "Opening Range Breakout": [
    { label: "Risk no more than 1% of the account", subject_source: "core", subject_key: "risk_percent", operator: "lte", number_value: 1 },
    { label: "Stop loss recorded before entry", subject_source: "core", subject_key: "stop_loss", operator: "is_set" },
    { label: "Planned R:R at least 1.5", subject_source: "core", subject_key: "risk_reward_ratio", operator: "gte", number_value: 1.5 },
    { label: "Long side only", subject_source: "core", subject_key: "direction", operator: "text_eq", text_value: "long" },
    { label: "Stop was not moved", subject_source: "derived", subject_key: "stop_moved", operator: "is_false" },
  ],
  "Trend Pullback": [
    { label: "Risk no more than 1% of the account", subject_source: "core", subject_key: "risk_percent", operator: "lte", number_value: 1 },
    { label: "Planned R:R at least 2", subject_source: "core", subject_key: "risk_reward_ratio", operator: "gte", number_value: 2 },
    { label: "Hold no longer than 10 sessions", subject_source: "derived", subject_key: "holding_days", operator: "lte", number_value: 10 },
    { label: "Emotion logged before entry", subject_source: "custom", subject_key: "emotion_before", operator: "is_set" },
  ],
  "VWAP Reclaim": [
    { label: "Risk no more than 0.75% of the account", subject_source: "core", subject_key: "risk_percent", operator: "lte", number_value: 0.75 },
    { label: "Stop loss recorded before entry", subject_source: "core", subject_key: "stop_loss", operator: "is_set" },
    { label: "Closed the same session", subject_source: "derived", subject_key: "holding_days", operator: "lte", number_value: 1 },
  ],
  "Swing Momentum": [
    { label: "Risk no more than 1.25%", subject_source: "core", subject_key: "risk_percent", operator: "lte", number_value: 1.25 },
    { label: "Planned R:R at least 2.5", subject_source: "core", subject_key: "risk_reward_ratio", operator: "gte", number_value: 2.5 },
    { label: "Target recorded before entry", subject_source: "core", subject_key: "take_profit", operator: "is_set" },
  ],
  "Crypto Breakout": [
    { label: "Risk no more than 0.6% (wider stops)", subject_source: "core", subject_key: "risk_percent", operator: "lte", number_value: 0.6 },
    { label: "Stop loss recorded before entry", subject_source: "core", subject_key: "stop_loss", operator: "is_set" },
  ],
  "Earnings Gap Fade": [
    { label: "Risk no more than 0.5% - lowest conviction setup", subject_source: "core", subject_key: "risk_percent", operator: "lte", number_value: 0.5 },
    { label: "Closed the same session", subject_source: "derived", subject_key: "holding_days", operator: "lte", number_value: 1 },
    { label: "Stop was not moved", subject_source: "derived", subject_key: "stop_moved", operator: "is_false" },
  ],
  "Range Reversal": [
    { label: "Risk no more than 0.5%", subject_source: "core", subject_key: "risk_percent", operator: "lte", number_value: 0.5 },
    { label: "No more than one attempt per session", subject_source: "custom", subject_key: "notes_why_entered", operator: "is_set" },
    { label: "Stop was not moved", subject_source: "derived", subject_key: "stop_moved", operator: "is_false" },
  ],
};

// ---------------------------------------------------------------- prose ----

const ENTRY_NOTES = {
  "Opening Range Breakout": [
    "{T} gapped up and built a tight 15-minute range on above-average volume. Took the break of the range high with the market also holding its opening range.",
    "Clean opening drive on {T}, first pullback held the range midpoint. Entered on the reclaim of the high with volume expanding into it.",
    "{T} opened into yesterday's high and coiled. Breakout with the sector strong, stop just under the range low.",
  ],
  "Trend Pullback": [
    "{T} has been in a clean uptrend and pulled back into the rising 20 EMA for the third time. Took the reversal candle off the average.",
    "Higher-timeframe trend on {T} is intact, first controlled pullback after a breakout. Entered as it reclaimed the prior day's high.",
    "Standard continuation on {T} - trend up, shallow pullback, entry on the resumption with the stop under the swing low.",
  ],
  "VWAP Reclaim": [
    "{T} broke down in the morning, failed, and reclaimed VWAP on rising volume. Entered on the reclaim with the stop under the low of the day.",
    "Failed breakdown on {T}. Sellers couldn't hold it below VWAP and it snapped back through - took it with a tight stop.",
    "{T} lost VWAP, made a lower low with no follow-through, then reclaimed. Classic trap, entered on the reclaim.",
  ],
  "Swing Momentum": [
    "{T} broke out of a three-week base on the highest volume in months. Took a starter position to hold for the continuation.",
    "Momentum continuation on {T} after the earnings gap held. Plan was to trail under the prior day's low and give it room.",
    "{T} tight consolidation right under the high, entered on the expansion day with a multi-session hold in mind.",
  ],
  "Crypto Breakout": [
    "{T} spent four days compressing under resistance and expanded through it. Sized smaller because the stop has to be wider than an equity trade.",
    "Range expansion on {T} out of a multi-day consolidation, funding still flat. Entered on the retest of the breakout level.",
    "{T} reclaimed the level it broke down from and held it on the retest. Took the continuation with a wide stop.",
  ],
  "Earnings Gap Fade": [
    "{T} gapped hard on earnings and stalled at the pre-market high. Faded it back toward the prior close.",
    "Over-extended earnings gap on {T} with no follow-through in the first 20 minutes. Took the fade - a setup I know is my weakest.",
    "{T} gap looked exhausted into the open, faded it against the prior close with a tight stop.",
  ],
  "Range Reversal": [
    "{T} was ranging all morning and pushed into the top of the range. Faded it expecting the range to hold.",
    "Counter-trend fade on {T} at the range extreme. I know the stats on this one and took it anyway.",
    "{T} pushed into the range high on fading volume, took the reversal back into the middle.",
  ],
};

// Notes are COMPOSED rather than picked from a fixed list. Three templates per
// strategy across 300-odd trades meant the same sentence appeared fifteen
// times, and the dashboard's "recent notes" card showed two identical entries
// side by side -- the single clearest tell that a journal is generated.
const CONTEXT_CLAUSES = [
  "Market was trending with it, so the setup had the tape behind it.",
  "Volume was above average on the trigger candle.",
  "Sector was leading on the day.",
  "Broad market was chopping, which is a caution flag I noted at the time.",
  "Higher timeframe had just broken out, so this was a continuation entry.",
  "Level had already been tested twice and held.",
  "Relative strength against the index was clear before entry.",
  "Nothing scheduled on the calendar until the close.",
  "Spread was tight and the fills were clean.",
  "Pre-market had already set the level I was watching.",
];

const MANAGEMENT_CLAUSES = [
  "Stop went in immediately after the fill.",
  "Planned to scale half at the first target and trail the rest.",
  "Sized to a fixed risk before I looked at the reward.",
  "Decided the invalidation level before entering, not after.",
  "Set an alert at the target rather than watching it tick.",
  "Position was small enough that I could leave it alone.",
  "Wrote the exit plan on the ticket before the entry filled.",
];

const WIN_RIGHT = [
  "Waited for the trigger instead of anticipating it, sized to plan, and took the target where I said I would.",
  "Entry was patient. Let the setup come to me and the stop never came close.",
  "Sized correctly and scaled out at the planned level rather than hoping for more.",
  "Followed the plan end to end - entry, stop, target, no interference once it was on.",
  "Left it alone once it was on. No fiddling, no early exit out of boredom.",
  "Took the setup that was actually in the plan rather than the one nearby that looked more exciting.",
  "Risk was defined before entry and never revisited mid-trade.",
];
const WIN_CHANGE = [
  "Could have held the runner longer - it went another 0.8R after I was out.",
  "Nothing major. Maybe a slightly larger size given how clean the setup was.",
  "Took the full position off at the first target when a partial would have been better.",
  "Entry was a few cents late chasing the trigger candle.",
  "Watched it too closely. The plan did not need me for those two hours.",
  "Could have added on the retest of the breakout level.",
];
const LOSS_RIGHT = [
  "Took the stop where I said I would instead of widening it.",
  "Kept the size small, so being wrong cost what it was supposed to cost.",
  "Cut it as soon as the thesis broke rather than waiting for the stop.",
  "Logged it honestly instead of quietly deleting it.",
  "Did not double down to get it back on the next setup.",
  "Closed the platform after this one rather than forcing another trade.",
];
const LOSS_CHANGE = [
  "Entered before the trigger actually confirmed - I was early, not wrong.",
  "This was a setup I had already decided to skip today. Should not have been in it.",
  "Size was too big for a setup with this hit rate.",
  "Took it late in the day when my numbers say I should be done trading.",
  "Ignored that the broad market was going the other way.",
  "Third attempt at the same idea. Once should have been enough.",
];
const WIN_LESSON = [
  "The boring, planned entries are the ones that pay.",
  "Patience on the entry is worth more than any tweak to the target.",
  "When the setup matches the plan exactly, size it properly.",
  "Doing nothing until the trigger fires is a strategy.",
  "Good trades feel slow. That is the point.",
];
const LOSS_LESSON = [
  "Stop taking this setup after 14:00 - the data says it stops working.",
  "Size is the only thing I fully control. Keep it at 1%.",
  "Trading to make back a loss is how a bad day turns into a bad week.",
  "If I have to talk myself into it, it is not the setup.",
  "The plan is only worth what I follow of it.",
];

const EMOTIONS = ["Calm", "Confident", "Fearful", "FOMO", "Excited", "Hesitant", "Stressed"];
const GOOD_EMOTIONS = ["Calm", "Confident"];

// ----------------------------------------------------------- the account ---

async function ensureUser() {
  const { data: list, error: listError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;

  const existing = list.users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase());
  if (existing) {
    const { error } = await db.auth.admin.updateUserById(existing.id, {
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: "Demo Trader", is_demo: true },
    });
    if (error) throw error;
    console.log(`Reusing existing account ${EMAIL} (${existing.id}) - wiping its journal first.`);
    return { id: existing.id, reused: true };
  }

  const { data, error } = await db.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "Demo Trader", is_demo: true },
  });
  if (error) throw error;
  console.log(`Created account ${EMAIL} (${data.user.id}).`);
  return { id: data.user.id, reused: false };
}

/** Removes only this user's journal rows. Trades cascade to trade_strategies,
 *  trade_folders, trade_history, trade_excursions and trade AI reviews. */
async function wipe(userId) {
  for (const table of ["ai_reviews", "trades", "strategy_rules", "strategies", "folders", "commission_rules", "account_transactions"]) {
    const { error } = await db.from(table).delete().eq("user_id", userId);
    if (error) throw new Error(`wipe ${table}: ${error.message}`);
  }
  // Strategy-scoped custom fields are re-created below; the default per-user
  // fields seeded by 0003/0034's trigger are left alone.
  const { error } = await db.from("field_definitions").delete().eq("user_id", userId).eq("is_default", false);
  if (error) throw new Error(`wipe field_definitions: ${error.message}`);
}

async function insertAll(table, rows, chunk = 250) {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await db.from(table).insert(rows.slice(i, i + chunk));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

// ------------------------------------------------------------- generation --

async function main() {
  const { id: userId } = await ensureUser();
  await wipe(userId);

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const startMs = todayStart.getTime() - DAYS * DAY_MS;

  // ---- settings -----------------------------------------------------------
  // upsert rather than update: the seed trigger normally creates this row, but
  // a reused account whose row was somehow removed must still end up correct.
  const { error: settingsError } = await db.from("user_settings").upsert(
    {
      user_id: userId,
      timezone: TIMEZONE,
      plan: "paid",
      has_completed_tour: true,
      hidden_core_fields: [],
      dashboard_layout: {
        order: ["performance", "calendar", "recent_trades", "best_worst_setup", "recent_emotions", "recent_notes"],
        sizes: {
          performance: "lg",
          calendar: "lg",
          recent_trades: "lg",
          best_worst_setup: "md",
          recent_emotions: "md",
          recent_notes: "md",
        },
      },
    },
    { onConflict: "user_id" },
  );
  if (settingsError) throw settingsError;

  // ---- cash ledger --------------------------------------------------------
  const ledger = [
    { offset: DAYS, amount: 45000, note: "Opening deposit - starting stake for the year" },
    { offset: Math.round(DAYS * 0.72), amount: 10000, note: "Added savings after a green quarter" },
    { offset: Math.round(DAYS * 0.42), amount: 12500, note: "Second funding round from salary" },
    { offset: Math.round(DAYS * 0.15), amount: -5000, note: "Profit withdrawal - paid myself" },
    { offset: 12, amount: 2500, note: "Monthly top-up" },
  ];
  await insertAll(
    "account_transactions",
    ledger.map((l) => ({
      user_id: userId,
      amount: l.amount,
      note: l.note,
      created_at: iso(todayStart.getTime() - l.offset * DAY_MS + 15 * HOUR_MS),
    })),
  );

  // ---- strategies + rules -------------------------------------------------
  const strategies = STRATEGY_DEFS.map((def, i) => ({
    id: randomUUID(),
    user_id: userId,
    name: def.name,
    description: def.description,
    color: def.color,
    sort_order: i,
    created_at: iso(startMs),
    updated_at: iso(startMs),
    def,
  }));
  await insertAll(
    "strategies",
    strategies.map(({ def: _def, ...row }) => row),
  );

  const rules = [];
  for (const s of strategies) {
    (RULES_BY_STRATEGY[s.name] ?? []).forEach((r, i) => {
      rules.push({
        id: randomUUID(),
        user_id: userId,
        strategy_id: s.id,
        label: r.label,
        subject_source: r.subject_source,
        subject_key: r.subject_key,
        operator: r.operator,
        number_value: r.number_value ?? null,
        number_value_max: r.number_value_max ?? null,
        text_value: r.text_value ?? null,
        enabled: true,
        sort_order: i,
        created_at: iso(startMs),
        updated_at: iso(startMs),
      });
    });
  }
  await insertAll("strategy_rules", rules);

  // Two strategy-scoped custom fields, so that half of the field engine isn't
  // invisible in the demo.
  const orb = strategies.find((s) => s.name === "Opening Range Breakout");
  const gap = strategies.find((s) => s.name === "Earnings Gap Fade");
  await insertAll("field_definitions", [
    {
      user_id: userId,
      entity_type: "trade",
      key: "orb_range_pct",
      label: "Opening range size (%)",
      field_type: "percentage",
      options: {},
      sort_order: 0,
      is_default: false,
      strategy_id: orb.id,
    },
    {
      user_id: userId,
      entity_type: "trade",
      key: "gap_percent",
      label: "Gap size (%)",
      field_type: "percentage",
      options: {},
      sort_order: 0,
      is_default: false,
      strategy_id: gap.id,
    },
  ]);

  // The Mistakes field ships with 0034's trigger, but a reused account created
  // before that migration would not have it -- and the mistake tracker is one
  // of the things this demo is meant to show.
  const { data: mistakeField } = await db
    .from("field_definitions")
    .select("id")
    .eq("user_id", userId)
    .eq("entity_type", "trade")
    .eq("key", "trade_mistakes")
    .maybeSingle();
  if (!mistakeField) {
    await insertAll("field_definitions", [
      {
        user_id: userId,
        entity_type: "trade",
        key: "trade_mistakes",
        label: "Mistakes",
        field_type: "tag",
        options: {
          choices: ["Moved stop", "Chased entry", "Oversized", "Exited too early", "Let loser run", "Broke strategy rules", "Revenge trade", "FOMO", "No plan"],
        },
        sort_order: 120,
        is_default: true,
      },
    ]);
  }

  // ---- commission rules ---------------------------------------------------
  // Crypto first: first enabled match wins, so the catch-all has to sit last.
  await insertAll("commission_rules", [
    {
      user_id: userId,
      name: "Crypto - 0.1% per side",
      rule_type: "percent",
      amount: 0.1,
      applies_to: "both",
      asset_type: "Crypto",
      market: null,
      min_fee: null,
      max_fee: null,
      enabled: true,
      sort_order: 0,
      created_at: iso(startMs),
      updated_at: iso(startMs),
    },
    {
      user_id: userId,
      name: "Equities - $1.00 per side",
      rule_type: "flat",
      amount: 1,
      applies_to: "both",
      asset_type: null,
      market: null,
      min_fee: null,
      max_fee: null,
      enabled: true,
      sort_order: 1,
      created_at: iso(startMs),
      updated_at: iso(startMs),
    },
  ]);

  // ---- journal generation ------------------------------------------------
  // One full attempt at the journal, for a given edge. Pure apart from the
  // module-level RNG and price book, both of which it resets on entry.
  function buildJournal(EDGE_BONUS) {
    resetRng(SEED);
    resetPrices();
  // ---- trades -------------------------------------------------------------
  const trades = [];
  const links = [];
  const history = [];
  const excursions = [];

  // Starts at zero: the opening deposit is the first row of the ledger below
  // and is credited on day 0 like every other transaction. Seeding this with
  // the opening figure as well double-counted it, and every position was sized
  // against an account larger than the one the dashboard reports.
  let balance = 0;
  const depositsByDay = new Map(ledger.map((l) => [DAYS - l.offset, l.amount]));

  function commissionFor(symbolInfo, entryPrice, exitPrice, shares) {
    if (symbolInfo.assetType === "Crypto") {
      const entryFee = entryPrice * shares * 0.001;
      const exitFee = exitPrice == null ? 0 : exitPrice * shares * 0.001;
      return round2(entryFee + exitFee);
    }
    return exitPrice == null ? 1 : 2;
  }

  let lastResultByDay = new Map();

  for (let d = 0; d <= DAYS; d++) {
    const dayMs = startMs + d * DAY_MS;
    const weekday = new Date(dayMs).getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;

    stepPrices(d);
    if (depositsByDay.has(d)) balance += depositsByDay.get(d);

    // How busy the day is. Weekends only ever carry the occasional crypto
    // trade; the last two weeks are always active so the account reads as
    // "in use right now" rather than "abandoned in July".
    const recent = DAYS - d <= 10;
    let count;
    if (isWeekend) {
      count = chance(0.18) ? 1 : 0;
    } else if (recent) {
      count = weightedPick([[1, 30], [2, 40], [3, 22], [4, 8]]);
      // Today specifically: the demo is opened during market hours as often as
      // after it, and a current session showing a single untouched entry reads
      // as abandoned rather than active.
      if (d === DAYS) count = Math.max(2, count);
    } else {
      count = weightedPick([[0, 26], [1, 30], [2, 26], [3, 13], [4, 5]]);
    }

    for (let n = 0; n < count; n++) {
      const def = isWeekend
        ? STRATEGY_DEFS.find((s) => s.name === "Crypto Breakout")
        : weightedPick(STRATEGY_DEFS.map((s) => [s, s.weight]));
      const strategy = strategies.find((s) => s.name === def.name);
      const symbolInfo = BY_TICKER[pick(def.tickers)];
      const entryPrice = symbolInfo.assetType === "Crypto"
        ? round2(priceBook[symbolInfo.ticker] * randBetween(0.995, 1.005))
        : round2(priceBook[symbolInfo.ticker] * randBetween(0.99, 1.01));

      // Entry time inside the US cash session; the first two hours carry most
      // of the volume, and the demo's "late-day trades are worse" bias needs
      // late entries to exist at all.
      // Today is generated only up to the current moment: the demo is looked at
      // during market hours as often as after the close, and a journal showing
      // trades that have not happened yet is worse than an empty day.
      const elapsedHours = (Date.now() - dayMs) / HOUR_MS;
      const latestHour = Math.min(19.6, elapsedHours - 0.4);
      if (latestHour <= 13.6) continue;
      const hourOffset = d === DAYS && n === 0
        // The first trade of today is taken on the open, so that by mid-morning
        // there is a closed trade on the board and not just live positions.
        ? randBetween(13.6, Math.min(13.9, latestHour))
        : weightedPick([
          [randBetween(13.6, Math.min(15.0, latestHour)), 46],
          [randBetween(Math.min(15.0, latestHour), Math.min(17.5, latestHour)), 28],
          [randBetween(Math.min(17.5, latestHour), latestHour), 26],
        ]);
      const entryMs = Math.round(dayMs + hourOffset * HOUR_MS);
      const etHour = hourOffset - 4;

      // Emotion: mostly composed, but FOMO/Stressed cluster late in the day
      // and straight after a loss -- which is what makes the emotion analytics
      // show a real pattern rather than uniform noise.
      const lostEarlierToday = lastResultByDay.get(d) === "loss";
      let emotionBefore;
      if (lostEarlierToday && chance(0.45)) emotionBefore = pick(["FOMO", "Stressed", "Excited"]);
      else if (etHour > 13.5 && chance(0.35)) emotionBefore = pick(["FOMO", "Hesitant", "Stressed"]);
      else emotionBefore = weightedPick([["Calm", 44], ["Confident", 26], ["Excited", 10], ["Hesitant", 8], ["FOMO", 6], ["Fearful", 3], ["Stressed", 3]]);

      const direction = def.name === "Earnings Gap Fade" || def.name === "Range Reversal"
        ? (chance(0.55) ? "short" : "long")
        : (chance(0.82) ? "long" : "short");

      // Sizing. The oversized minority is deliberate: it is what the mistake
      // tracker, the plan-rule breaches and the "size discipline" insight are
      // all keyed off.
      const oversized = (lostEarlierToday && chance(0.25)) || chance(0.05);
      const riskPercent = oversized
        ? round2(randBetween(1.5, 2.2))
        : round2(randBetween(0.45, def.name === "Earnings Gap Fade" ? 0.8 : 1.05));

      const stopPct = randBetween(def.stopPct[0], def.stopPct[1]);
      const stopDistance = entryPrice * stopPct;
      const targetRiskAmount = (balance * riskPercent) / 100;
      let shares = symbolInfo.assetType === "Crypto"
        ? round4(Math.max(0.002, targetRiskAmount / stopDistance))
        : Math.max(1, Math.round(targetRiskAmount / stopDistance));

      // Buying-power cap. Risk-based sizing alone puts an absurd notional on a
      // tight-stop trade -- a 0.6% stop at 1% risk is a position worth 1.6x the
      // whole account -- which made the dashboard report half a million in
      // committed cash against a $45k balance. Real accounts hit a buying-power
      // limit first, so the position is capped and the realised risk falls out
      // of the share count rather than the other way round.
      // Intraday positions get day-trading leverage (they are flat by the
      // close, so they never stack); swings are capped far tighter because
      // several are open at once and their notionals add up in committed cash.
      const maxPosition = balance * (symbolInfo.assetType === "Crypto" ? 0.06 : def.style === "intraday" ? 1.2 : 0.045);
      if (entryPrice * shares > maxPosition) {
        shares = symbolInfo.assetType === "Crypto"
          ? round4(Math.max(0.002, maxPosition / entryPrice))
          : Math.max(1, Math.floor(maxPosition / entryPrice));
      }
      const riskAmount = round2(shares * stopDistance);
      const realisedRiskPercent = round2((riskAmount / balance) * 100);
      const sign = direction === "long" ? 1 : -1;
      const stopLoss = round2(entryPrice - sign * stopDistance);
      const plannedR = randBetween(def.plannedR[0], def.plannedR[1]);
      const takeProfit = round2(entryPrice + sign * stopDistance * plannedR);

      // Outcome. Every modifier here is a bias the app is supposed to surface.
      let p = def.winRate + EDGE_BONUS;
      if (GOOD_EMOTIONS.includes(emotionBefore)) p += 0.08;
      else if (["FOMO", "Stressed", "Fearful"].includes(emotionBefore)) p -= 0.15;
      else if (emotionBefore === "Excited") p -= 0.05;
      if (weekday === 2) p += 0.05;
      else if (weekday === 1) p += 0.02;
      else if (weekday === 5) p -= 0.07;
      if (etHour < 11) p += 0.05;
      else if (etHour >= 14) p -= 0.07;
      if (oversized) p -= 0.1;
      if (direction === "short") p -= 0.04;
      p = Math.min(0.9, Math.max(0.06, p));

      const won = chance(p);
      const letLoserRun = !won && chance(0.07);
      const exitedEarly = won && chance(0.18);
      const rTarget = won
        ? def.winR * randBetween(0.45, 1.45) * (exitedEarly ? 0.6 : 1)
        : -(letLoserRun ? randBetween(1.2, 1.8) : randBetween(0.5, 1.0));

      const exitPrice = round2(entryPrice + sign * stopDistance * rTarget);

      // Holding period: intraday setups close in the same session, swings run
      // over sessions (crypto over weekends too, equities skipping them).
      let exitMs;
      let holdingDays;
      if (def.style === "intraday") {
        exitMs = Math.min(entryMs + randBetween(0.4, 4.5) * HOUR_MS, dayMs + 19.9 * HOUR_MS);
        // A day trade is flat by the close. Left alone, every one of today's
        // trades whose computed exit is still in the future would sit in the
        // journal as an open position, stacking a day's worth of intraday
        // notional into the dashboard's committed-cash figure. Only a trade
        // entered in the last half hour or so is genuinely still on.
        const nowMs = Date.now();
        if (exitMs > nowMs && nowMs - entryMs > 25 * 60_000) {
          exitMs = nowMs - randBetween(2, 25) * 60_000;
        }
        holdingDays = 0;
      } else {
        holdingDays = randInt(1, 8);
        let cursor = dayMs;
        let added = 0;
        while (added < holdingDays) {
          cursor += DAY_MS;
          const wd = new Date(cursor).getUTCDay();
          if (symbolInfo.assetType === "Crypto" || (wd !== 0 && wd !== 6)) added++;
        }
        exitMs = cursor + randBetween(14, 19.8) * HOUR_MS;
      }
      exitMs = Math.round(exitMs);

      const stillOpen = exitMs > Date.now();
      const commission = commissionFor(symbolInfo, entryPrice, stillOpen ? null : exitPrice, shares);
      const dollarAmount = round2(entryPrice * shares);

      const tradeId = randomUUID();
      const mistakes = [];
      if (realisedRiskPercent > 1.4) mistakes.push("Oversized");
      if (lostEarlierToday && realisedRiskPercent > 1.1) mistakes.push("Revenge trade");
      if (emotionBefore === "FOMO") mistakes.push(chance(0.5) ? "FOMO" : "Chased entry");
      if (letLoserRun) mistakes.push("Let loser run");
      if (exitedEarly && chance(0.6)) mistakes.push("Exited too early");
      if (realisedRiskPercent > 1 && chance(0.4)) mistakes.push("Broke strategy rules");

      const movedStop = !won && chance(0.14);
      if (movedStop) mistakes.push("Moved stop");

      const notes = [
        pick(ENTRY_NOTES[def.name]).replaceAll("{T}", symbolInfo.ticker),
        pick(CONTEXT_CLAUSES),
        pick(MANAGEMENT_CLAUSES),
      ].join(" ");
      const strategyFieldValues = {};
      if (def.name === "Opening Range Breakout") {
        strategyFieldValues[strategy.id] = { orb_range_pct: round2(randBetween(0.3, 1.4)) };
      } else if (def.name === "Earnings Gap Fade") {
        strategyFieldValues[strategy.id] = { gap_percent: round2(randBetween(3, 14) * (direction === "short" ? 1 : -1)) };
      }

      if (stillOpen) {
        // A position that is still on: no exit, no realised P&L.
        trades.push({
          id: tradeId,
          user_id: userId,
          mode: "trade",
          ticker: symbolInfo.ticker,
          company_name: symbolInfo.company,
          asset_type: symbolInfo.assetType,
          market: symbolInfo.market,
          direction,
          status: "open",
          result: "open",
          entry_price: entryPrice,
          exit_price: null,
          stop_loss: stopLoss,
          take_profit: takeProfit,
          shares,
          position_size: dollarAmount,
          dollar_amount: dollarAmount,
          risk_amount: riskAmount,
          risk_percent: realisedRiskPercent,
          entry_date: iso(entryMs),
          exit_date: null,
          dollar_pl: null,
          percent_return: null,
          r_multiple: null,
          risk_reward_ratio: round2(Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss)),
          commission,
          commission_manual: false,
          custom_fields: {
            notes_why_entered: notes,
            notes_what_right: "",
            notes_what_change: "",
            notes_lessons_learned: "",
            notes_additional: "",
            emotion_before: [emotionBefore],
            emotion_during: [],
            emotion_after: [],
            emotion_intensity: randInt(3, 8),
            trade_mistakes: [],
          },
          strategy_field_values: strategyFieldValues,
          created_at: iso(entryMs),
          updated_at: iso(entryMs),
        });
        links.push({ trade_id: tradeId, strategy_id: strategy.id });
        continue;
      }

      // dollar_pl mirrors computeDerivedFields exactly: net of commission, and
      // derived from the ROUNDED exit price, so re-saving the trade in the app
      // recomputes the same number instead of silently correcting it.
      const dollarPl = round2((exitPrice - entryPrice) * shares * sign - commission);
      const percentReturn = round2((dollarPl / Math.abs(entryPrice * shares)) * 100);
      const rMultiple = round2(dollarPl / riskAmount);
      const result = dollarPl > 0 ? "win" : dollarPl < 0 ? "loss" : "break_even";
      balance += dollarPl;
      lastResultByDay.set(d, result);

      const emotionDuring = result === "win"
        ? weightedPick([["Calm", 40], ["Confident", 35], ["Excited", 15], ["Hesitant", 10]])
        : weightedPick([["Stressed", 35], ["Fearful", 25], ["Hesitant", 20], ["Calm", 20]]);
      const emotionAfter = result === "win"
        ? pick(["Confident", "Calm", "Excited"])
        : pick(["Stressed", "Hesitant", "Fearful", "Calm"]);

      trades.push({
        id: tradeId,
        user_id: userId,
        mode: "trade",
        ticker: symbolInfo.ticker,
        company_name: symbolInfo.company,
        asset_type: symbolInfo.assetType,
        market: symbolInfo.market,
        direction,
        status: "closed",
        result,
        entry_price: entryPrice,
        exit_price: exitPrice,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        shares,
        position_size: dollarAmount,
        dollar_amount: dollarAmount,
        risk_amount: riskAmount,
        risk_percent: realisedRiskPercent,
        entry_date: iso(entryMs),
        exit_date: iso(exitMs),
        dollar_pl: dollarPl,
        percent_return: percentReturn,
        r_multiple: rMultiple,
        risk_reward_ratio: round2(Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss)),
        commission,
        commission_manual: false,
        custom_fields: {
          notes_why_entered: notes,
          notes_what_right: result === "win" ? pick(WIN_RIGHT) : pick(LOSS_RIGHT),
          notes_what_change: result === "win" ? pick(WIN_CHANGE) : pick(LOSS_CHANGE),
          notes_lessons_learned: result === "win" ? pick(WIN_LESSON) : pick(LOSS_LESSON),
          notes_additional: mistakes.length ? `Flagged: ${mistakes.join(", ")}.` : "",
          emotion_before: [emotionBefore],
          emotion_during: [emotionDuring],
          emotion_after: [emotionAfter],
          emotion_intensity: result === "win" ? randInt(3, 7) : randInt(5, 10),
          trade_mistakes: mistakes,
        },
        strategy_field_values: strategyFieldValues,
        created_at: iso(entryMs),
        updated_at: iso(exitMs),
      });
      links.push({ trade_id: tradeId, strategy_id: strategy.id });

      // A moved stop only exists in the edit-history snapshots (0008), so the
      // pre-edit rows have to be written for the detection to see anything.
      if (movedStop) {
        const originalStop = round2(entryPrice - sign * stopDistance * randBetween(0.45, 0.8));
        history.push({
          trade_id: tradeId,
          user_id: userId,
          created_at: iso(entryMs + 20 * 60_000),
          snapshot: {
            id: tradeId,
            user_id: userId,
            ticker: symbolInfo.ticker,
            status: "open",
            direction,
            entry_price: entryPrice,
            exit_price: null,
            stop_loss: originalStop,
            take_profit: takeProfit,
            shares,
            entry_date: iso(entryMs),
          },
        });
      }

      // MAE/MFE only mean anything across more than one daily bar -- a same-day
      // trade is `same_day` in the real calculator, so it gets no row here.
      if (holdingDays >= 1) {
        const favourExit = (exitPrice - entryPrice) * sign;
        const best = Math.max(favourExit, 0) + stopDistance * randBetween(0.15, 1.1);
        const worstCap = won ? stopDistance * 0.95 : stopDistance * randBetween(1.0, 1.6);
        const worst = -Math.min(worstCap, stopDistance * randBetween(0.2, 1.5));
        excursions.push({
          trade_id: tradeId,
          user_id: userId,
          symbol: symbolInfo.assetType === "Crypto" ? symbolInfo.ticker.replace("USD", "-USD") : symbolInfo.ticker,
          status: "ok",
          mae_price: round2(entryPrice + sign * worst),
          mfe_price: round2(entryPrice + sign * best),
          mae_percent: round2((worst / entryPrice) * 100),
          mfe_percent: round2((best / entryPrice) * 100),
          mae_r: round2(worst / stopDistance),
          mfe_r: round2(best / stopDistance),
          candles_used: holdingDays + 1,
          includes_partial_days: true,
          computed_at: iso(exitMs + 6 * HOUR_MS),
        });
      }
    }
  }

  // ---- live positions ----------------------------------------------------
  // Generated explicitly rather than left to chance: the main loop only leaves
  // a trade open when its exit lands in the future, which almost never happens,
  // and an account in daily use always has something on.
  for (let i = 0; i < 2; i++) {
    const def = weightedPick(STRATEGY_DEFS.filter((s) => s.style === "swing").map((s) => [s, s.weight]));
    const strategy = strategies.find((s) => s.name === def.name);
    const symbolInfo = BY_TICKER[pick(def.tickers)];
    const entryPrice = round2(priceBook[symbolInfo.ticker] * randBetween(0.985, 1.01));
    const direction = chance(0.8) ? "long" : "short";
    const sign = direction === "long" ? 1 : -1;
    const stopDistance = entryPrice * randBetween(def.stopPct[0], def.stopPct[1]);
    const riskPercent = round2(randBetween(0.5, 1.0));
    const maxPosition = balance * (symbolInfo.assetType === "Crypto" ? 0.06 : def.style === "intraday" ? 1.2 : 0.045);
    const rawShares = symbolInfo.assetType === "Crypto"
      ? round4(Math.max(0.002, (balance * riskPercent) / 100 / stopDistance))
      : Math.max(1, Math.round((balance * riskPercent) / 100 / stopDistance));
    const shares = entryPrice * rawShares > maxPosition
      ? (symbolInfo.assetType === "Crypto"
        ? round4(Math.max(0.002, maxPosition / entryPrice))
        : Math.max(1, Math.floor(maxPosition / entryPrice)))
      : rawShares;
    // Walk back to a weekday and enter inside the cash session: an entry
    // stamped 06:15 on a Saturday is the kind of detail that gives a fixture
    // away immediately.
    let entryDay = new Date(todayStart.getTime() - randInt(1, 6) * DAY_MS);
    while (entryDay.getUTCDay() === 0 || entryDay.getUTCDay() === 6) {
      entryDay = new Date(entryDay.getTime() - DAY_MS);
    }
    const entryMs = Math.min(Date.now() - HOUR_MS, entryDay.getTime() + randBetween(13.6, 19.5) * HOUR_MS);
    const takeProfit = round2(entryPrice + sign * stopDistance * randBetween(2, 3));
    const stopLoss = round2(entryPrice - sign * stopDistance);
    const tradeId = randomUUID();
    trades.push({
      id: tradeId,
      user_id: userId,
      mode: "trade",
      ticker: symbolInfo.ticker,
      company_name: symbolInfo.company,
      asset_type: symbolInfo.assetType,
      market: symbolInfo.market,
      direction,
      status: "open",
      result: "open",
      entry_price: entryPrice,
      exit_price: null,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      shares,
      position_size: round2(entryPrice * shares),
      dollar_amount: round2(entryPrice * shares),
      risk_amount: round2(shares * stopDistance),
      risk_percent: round2(((shares * stopDistance) / balance) * 100),
      entry_date: iso(Math.round(entryMs)),
      exit_date: null,
      dollar_pl: null,
      percent_return: null,
      r_multiple: null,
      risk_reward_ratio: round2(Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss)),
      commission: commissionFor(symbolInfo, entryPrice, null, shares),
      commission_manual: false,
      custom_fields: {
        notes_why_entered: `${pick(ENTRY_NOTES[def.name]).replaceAll("{T}", symbolInfo.ticker)} ${pick(CONTEXT_CLAUSES)} ${pick(MANAGEMENT_CLAUSES)}`,
        notes_what_right: "",
        notes_what_change: "",
        notes_lessons_learned: "",
        notes_additional: "Still on. Trailing under the prior session low.",
        emotion_before: [weightedPick([["Calm", 55], ["Confident", 30], ["Hesitant", 15]])],
        emotion_during: [pick(["Calm", "Confident", "Hesitant"])],
        emotion_after: [],
        emotion_intensity: randInt(3, 7),
        trade_mistakes: [],
      },
      strategy_field_values: {},
      created_at: iso(Math.round(entryMs)),
      updated_at: iso(Math.round(entryMs)),
    });
    links.push({ trade_id: tradeId, strategy_id: strategy.id });
  }

  // ---- planned (pending) setups, sitting on the watchlist -----------------
  for (let i = 0; i < 3; i++) {
    const def = pick(STRATEGY_DEFS.filter((s) => s.style === "swing"));
    const strategy = strategies.find((s) => s.name === def.name);
    const symbolInfo = BY_TICKER[pick(def.tickers)];
    const entryPrice = round2(priceBook[symbolInfo.ticker] * randBetween(1.0, 1.02));
    const stopDistance = entryPrice * randBetween(def.stopPct[0], def.stopPct[1]);
    const maxPosition = balance * (symbolInfo.assetType === "Crypto" ? 0.06 : 0.045);
    const rawShares = symbolInfo.assetType === "Crypto"
      ? round4(Math.max(0.002, (balance * 0.006) / stopDistance))
      : Math.max(1, Math.round((balance * 0.008) / stopDistance));
    const shares = entryPrice * rawShares > maxPosition
      ? (symbolInfo.assetType === "Crypto"
        ? round4(Math.max(0.002, maxPosition / entryPrice))
        : Math.max(1, Math.floor(maxPosition / entryPrice)))
      : rawShares;
    const tradeId = randomUUID();
    const createdMs = todayStart.getTime() - randInt(0, 3) * DAY_MS + 14 * HOUR_MS;
    trades.push({
      id: tradeId,
      user_id: userId,
      mode: "trade",
      ticker: symbolInfo.ticker,
      company_name: symbolInfo.company,
      asset_type: symbolInfo.assetType,
      market: symbolInfo.market,
      direction: "long",
      status: "pending",
      result: "open",
      entry_price: entryPrice,
      exit_price: null,
      stop_loss: round2(entryPrice - stopDistance),
      take_profit: round2(entryPrice + stopDistance * randBetween(2, 3)),
      shares,
      position_size: round2(entryPrice * shares),
      dollar_amount: round2(entryPrice * shares),
      risk_amount: round2(shares * stopDistance),
      risk_percent: round2(((shares * stopDistance) / balance) * 100),
      entry_date: null,
      exit_date: null,
      dollar_pl: null,
      percent_return: null,
      r_multiple: null,
      risk_reward_ratio: round2(randBetween(2, 3)),
      commission: null,
      commission_manual: false,
      custom_fields: {
        notes_why_entered: `Watchlist for tomorrow: ${symbolInfo.ticker} is coiling right under the level. Triggers only if it takes the high on volume - no trigger, no trade.`,
        notes_what_right: "",
        notes_what_change: "",
        notes_lessons_learned: "",
        notes_additional: "",
        emotion_before: ["Calm"],
        emotion_during: [],
        emotion_after: [],
        emotion_intensity: randInt(2, 5),
        trade_mistakes: [],
      },
      strategy_field_values: {},
      created_at: iso(createdMs),
      updated_at: iso(createdMs),
    });
    links.push({ trade_id: tradeId, strategy_id: strategy.id });
  }

  // ---- long-term holdings (investment mode) ------------------------------
  const holdings = [
    { ticker: "VOO", company: "Vanguard S&P 500 ETF", assetType: "ETF", market: "NYSE", cost: 402.15, price: 548.9, qty: 14, yield: 1.3, note: "Core holding. Automatic monthly buy on the 1st, never sold." },
    { ticker: "VTI", company: "Vanguard Total Stock Market ETF", assetType: "ETF", market: "NYSE", cost: 232.4, price: 296.75, qty: 9, yield: 1.4, note: "Second core position alongside VOO for total-market coverage." },
    { ticker: "MSFT", company: "Microsoft Corp.", assetType: "Stock", market: "NASDAQ", cost: 288.6, price: 421.3, qty: 7, yield: 0.7, note: "Long-term hold, kept completely separate from the swing account." },
    { ticker: "BTCUSD", company: null, assetType: "Crypto", market: "Crypto", cost: 38400, price: 62150, qty: 0.08, yield: 0, note: "Long-term speculative allocation. Cold storage, not traded." },
  ];
  for (const h of holdings) {
    const value = round2(h.price * h.qty);
    trades.push({
      id: randomUUID(),
      user_id: userId,
      mode: "investment",
      ticker: h.ticker,
      company_name: h.company,
      asset_type: h.assetType,
      market: h.market,
      direction: "long",
      status: "open",
      result: "open",
      entry_date: iso(startMs - randInt(60, 400) * DAY_MS),
      // Every key the closed-trade rows carry has to appear here too: a batch
      // insert sends one column list for the whole chunk, so a key omitted on
      // these rows arrives as an explicit NULL and trips commission_manual's
      // not-null default.
      exit_date: null,
      entry_price: null,
      exit_price: null,
      stop_loss: null,
      take_profit: null,
      shares: null,
      position_size: null,
      dollar_amount: null,
      risk_amount: null,
      risk_percent: null,
      dollar_pl: null,
      percent_return: null,
      r_multiple: null,
      risk_reward_ratio: null,
      commission: null,
      commission_manual: false,
      custom_fields: {
        average_cost: h.cost,
        current_price: h.price,
        total_shares: h.qty,
        total_value: value,
        unrealized_gain_loss: round2(value - h.cost * h.qty),
        dividend_yield: h.yield,
        long_term_notes: h.note,
      },
      strategy_field_values: {},
      created_at: iso(startMs),
      updated_at: iso(todayStart.getTime()),
    });
  }


    return { trades, links, history, excursions, balance };
  }

  // Keep the attempt whose result reads most like a competent trader's year:
  // a positive but not absurd return, and a win rate that is neither a coin
  // flip nor a fantasy.
  let best = null;
  for (const bonus of EDGE_CANDIDATES) {
    const attempt = buildJournal(bonus);
    const closedRows = attempt.trades.filter((t) => t.status === "closed" && t.mode === "trade");
    if (closedRows.length === 0) continue;
    const netPl = closedRows.reduce((sum, t) => sum + t.dollar_pl, 0);
    const winRate = closedRows.filter((t) => t.dollar_pl > 0).length / closedRows.length;
    const deposited = ledger.reduce((sum, l) => sum + l.amount, 0);
    // What "believable" means here, in the order it is visible to someone
    // opening the demo:
    //   - a positive but not absurd return, and a win rate that is neither a
    //     coin flip nor a fantasy;
    //   - available cash that is not deeply negative. The dashboard subtracts
    //     every open and pending notional AND the investment book at cost from
    //     the balance, with no notion of margin, so an attempt carrying a dozen
    //     live positions renders as a five-figure hole;
    //   - a closed trade on today's date, so the current session reads as
    //     traded rather than merely opened.
    const openRows = attempt.trades.filter(
      (t) => t.mode === "trade" && (t.status === "open" || t.status === "pending"),
    );
    const committed =
      openRows.reduce((sum, t) => sum + Number(t.dollar_amount ?? 0), 0) +
      attempt.trades
        .filter((t) => t.mode === "investment")
        .reduce((sum, t) => sum + t.custom_fields.average_cost * t.custom_fields.total_shares, 0);
    const available = deposited + netPl - committed;
    const today = dayString(Date.now());
    const closedToday = closedRows.some((t) => t.exit_date.slice(0, 10) === today);
    const score =
      Math.abs(netPl / deposited - TARGET_RETURN) +
      Math.max(0, 0.47 - winRate) * 4 +
      Math.max(0, winRate - 0.58) * 4 +
      Math.max(0, -available / deposited) * 2 +
      Math.max(0, openRows.length - 9) * 0.1 +
      (closedToday ? 0 : 0.35);
    if (!best || score < best.score) {
      best = { ...attempt, score, bonus, netPl, winRate };
    }
  }
  if (!best) throw new Error("journal generation produced no closed trades");
  console.log(
    `calibrated edge ${best.bonus} -> ${Math.round(best.winRate * 100)}% win rate, ` +
    `net ${Math.round(best.netPl)} on ${ledger.reduce((s, l) => s + l.amount, 0)} deposited, ` +
    `score ${best.score.toFixed(3)}`,
  );
  const { trades, links, history, excursions } = best;

  await insertAll("trades", trades);
  await insertAll("trade_strategies", links);
  await insertAll("trade_history", history);
  await insertAll("trade_excursions", excursions);

  // ---- folders ------------------------------------------------------------
  const closed = trades.filter((t) => t.status === "closed" && t.mode === "trade");
  const byR = [...closed].sort((a, b) => (b.r_multiple ?? 0) - (a.r_multiple ?? 0));
  const folderDefs = [
    { name: "A+ Setups", members: byR.slice(0, 14) },
    { name: "Needs Review", members: byR.slice(-12) },
    { name: "Swing Trades", members: closed.filter((t) => t.entry_date.slice(0, 10) !== t.exit_date.slice(0, 10)).slice(0, 25) },
    { name: "Day Trades", members: closed.filter((t) => t.entry_date.slice(0, 10) === t.exit_date.slice(0, 10)).slice(0, 25) },
  ];
  const folderRows = folderDefs.map((f, i) => ({
    id: randomUUID(),
    user_id: userId,
    name: f.name,
    created_at: iso(startMs + i * DAY_MS),
  }));
  await insertAll("folders", folderRows);
  await insertAll(
    "trade_folders",
    folderDefs.flatMap((f, i) => f.members.map((t) => ({ trade_id: t.id, folder_id: folderRows[i].id }))),
  );

  // ---- AI reviews ---------------------------------------------------------
  // Every number below is computed from the trades just seeded, so a viewer
  // who checks a review against the analytics page finds the same figures.
  function statsFor(rows) {
    const wins = rows.filter((t) => t.dollar_pl > 0);
    const losses = rows.filter((t) => t.dollar_pl < 0);
    const net = round2(rows.reduce((s, t) => s + t.dollar_pl, 0));
    const avgR = rows.length ? round2(rows.reduce((s, t) => s + t.r_multiple, 0) / rows.length) : 0;
    const byStrategy = new Map();
    for (const t of rows) {
      const name = strategies.find((s) => s.id === links.find((l) => l.trade_id === t.id)?.strategy_id)?.name ?? "Unknown";
      const entry = byStrategy.get(name) ?? { name, n: 0, net: 0, wins: 0 };
      entry.n++;
      entry.net = round2(entry.net + t.dollar_pl);
      if (t.dollar_pl > 0) entry.wins++;
      byStrategy.set(name, entry);
    }
    const ranked = [...byStrategy.values()].sort((a, b) => b.net - a.net);
    return {
      n: rows.length,
      wins: wins.length,
      losses: losses.length,
      winRate: rows.length ? Math.round((wins.length / rows.length) * 100) : 0,
      net,
      avgR,
      best: ranked[0],
      worst: ranked[ranked.length - 1],
      avgWin: wins.length ? round2(wins.reduce((s, t) => s + t.dollar_pl, 0) / wins.length) : 0,
      avgLoss: losses.length ? round2(losses.reduce((s, t) => s + t.dollar_pl, 0) / losses.length) : 0,
    };
  }

  const money = (n) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const reviews = [];

  function periodReview(kind, startDay, endDay) {
    const rows = closed.filter((t) => t.exit_date.slice(0, 10) >= startDay && t.exit_date.slice(0, 10) <= endDay);
    if (rows.length < 4) return;
    const s = statsFor(rows);
    const mistakeCounts = new Map();
    for (const t of rows) for (const m of t.custom_fields.trade_mistakes ?? []) mistakeCounts.set(m, (mistakeCounts.get(m) ?? 0) + 1);
    const topMistake = [...mistakeCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const calm = rows.filter((t) => GOOD_EMOTIONS.includes(t.custom_fields.emotion_before?.[0]));
    const calmWinRate = calm.length ? Math.round((calm.filter((t) => t.dollar_pl > 0).length / calm.length) * 100) : 0;

    reviews.push({
      id: randomUUID(),
      user_id: userId,
      review_type: kind,
      trade_id: null,
      period_start: startDay,
      period_end: endDay,
      trades_analyzed: s.n,
      provider: "anthropic",
      model: "claude-sonnet-5",
      source_updated_at: iso(Date.now()),
      created_at: iso(new Date(`${endDay}T22:00:00.000Z`).getTime() + 12 * HOUR_MS),
      content: {
        performance_summary: `${s.n} closed trades over this ${kind === "weekly" ? "week" : "month"}: ${s.wins} winners, ${s.losses} losers, a ${s.winRate}% hit rate and ${money(s.net)} net after commissions, averaging ${s.avgR}R per trade. Average winner ${money(s.avgWin)} against an average loser of ${money(s.avgLoss)}. ${s.net >= 0 ? "The result came from the planned setups rather than from any single outsized trade." : "The damage was concentrated in the lower-quality setups rather than spread evenly."}`,
        what_went_well: [
          `${s.best.name} carried the ${kind === "weekly" ? "week" : "month"}: ${s.best.n} trades, ${Math.round((s.best.wins / s.best.n) * 100)}% win rate, ${money(s.best.net)}.`,
          `Entries taken in a calm or confident state won ${calmWinRate}% of the time across ${calm.length} trades.`,
          "Stops were recorded before entry on every position, so nothing was sized by guesswork.",
        ],
        what_went_wrong: [
          `${s.worst.name} lost ${money(s.worst.net)} across ${s.worst.n} trades and remains the weakest thing in the journal.`,
          topMistake ? `"${topMistake[0]}" was logged on ${topMistake[1]} trades - the most frequent self-flagged error this period.` : "",
          "Several entries were taken after 14:00 ET, where the historical hit rate is materially lower.",
        ].filter(Boolean),
        biggest_edge: {
          finding: `${s.best.name} taken before 11:00 ET is the strongest repeatable pattern in this period.`,
          evidence: `${s.best.n} trades, ${money(s.best.net)} net, ${Math.round((s.best.wins / s.best.n) * 100)}% win rate.`,
          confidence: s.best.n >= 12 ? "medium" : "low",
        },
        biggest_leak: {
          finding: `${s.worst.name} continues to lose money and is being taken at full size.`,
          evidence: `${s.worst.n} trades for ${money(s.worst.net)} in this period alone.`,
          confidence: s.worst.n >= 10 ? "medium" : "insufficient_data",
        },
        behavioral_patterns: [
          { pattern: "Size increases immediately after a loss", evidence: `Trades flagged "Oversized" or "Revenge trade" cluster on days that opened with a losing trade.`, confidence: "medium" },
          { pattern: "Late-session entries underperform", evidence: "Entries after 14:00 ET show a lower hit rate than the same setups taken in the first two hours.", confidence: "medium" },
        ],
        strategy_breakdown: [
          { strategy: s.best.name, verdict: `Working. ${money(s.best.net)} across ${s.best.n} trades.`, sample_note: s.best.n < 10 ? "Small sample - treat as directional only." : "" },
          { strategy: s.worst.name, verdict: `Not working. ${money(s.worst.net)} across ${s.worst.n} trades.`, sample_note: s.worst.n < 10 ? "Small sample, but consistent with the longer history." : "" },
        ],
        risk_review: [
          `Risk per trade stayed at or below 1% on the majority of entries; the exceptions are the ones flagged "Oversized".`,
          "No single loss exceeded roughly 2R, so the tail stayed controlled even on the worst days.",
        ],
        period_comparison: kind === "weekly" ? "Broadly in line with the preceding weeks: the same two setups produce the profit and the same one gives it back." : "",
        priorities: [
          `Stop taking ${s.worst.name} at full size until it shows 20 trades of positive expectancy at half size.`,
          "Hard stop on new entries after 14:00 ET.",
          "Fixed 1% risk. No discretionary sizing after a losing trade.",
        ],
        missing_information: ["Entry screenshots are missing on most trades, so setup quality cannot be verified independently."],
      },
    });
  }

  // Eight trailing weeks and the last three whole months.
  for (let w = 1; w <= 8; w++) {
    const end = todayStart.getTime() - (w - 1) * 7 * DAY_MS - DAY_MS;
    periodReview("weekly", dayString(end - 6 * DAY_MS), dayString(end));
  }
  for (let m = 1; m <= 3; m++) {
    const ref = new Date(todayStart);
    ref.setUTCMonth(ref.getUTCMonth() - m, 1);
    const first = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1);
    const last = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0);
    periodReview("monthly", dayString(first), dayString(last));
  }

  // A handful of single-trade reviews on the trades a trader would actually
  // have spent a review on: the outliers at both ends.
  const notable = [...byR.slice(0, 3), ...byR.slice(-3)];
  for (const t of notable) {
    const strategyName = strategies.find((s) => s.id === links.find((l) => l.trade_id === t.id)?.strategy_id)?.name ?? "Unknown";
    const win = t.dollar_pl > 0;
    const mistakes = t.custom_fields.trade_mistakes ?? [];
    reviews.push({
      id: randomUUID(),
      user_id: userId,
      review_type: "trade",
      trade_id: t.id,
      period_start: null,
      period_end: null,
      trades_analyzed: 1,
      provider: "anthropic",
      model: "claude-sonnet-5",
      source_updated_at: iso(Date.now()),
      created_at: iso(new Date(t.exit_date).getTime() + 20 * HOUR_MS),
      content: {
        overall_assessment: `${t.ticker} ${t.direction} on the ${strategyName} setup, risking ${t.risk_percent}% of the account and closing for ${money(t.dollar_pl)} (${t.r_multiple}R). ${win ? "The setup matched the written plan and the exit was taken where the plan said to take it." : "The setup was valid but the execution was not: this is where the plan and what actually happened diverge."} ${mistakes.length ? `Self-flagged on this trade: ${mistakes.join(", ")}.` : "No mistakes were flagged on this trade."}`,
        score: win ? randInt(72, 91) : randInt(28, 52),
        score_breakdown: {
          setup_quality: win ? randInt(70, 92) : randInt(40, 65),
          entry_quality: win ? randInt(68, 90) : randInt(30, 60),
          risk_management: mistakes.includes("Oversized") ? randInt(20, 40) : randInt(70, 92),
          exit_management: mistakes.includes("Exited too early") || mistakes.includes("Let loser run") ? randInt(30, 50) : randInt(65, 88),
          plan_adherence: mistakes.length ? randInt(30, 55) : randInt(75, 93),
          emotional_discipline: GOOD_EMOTIONS.includes(t.custom_fields.emotion_before?.[0]) ? randInt(70, 92) : randInt(30, 55),
        },
        what_went_well: win
          ? ["Entry waited for the trigger rather than anticipating it.", `Stop was recorded at $${t.stop_loss} before entry and never widened.`, "The exit was taken at the planned level instead of being negotiated."]
          : ["The loss was taken rather than averaged into.", `Position was closed at ${t.r_multiple}R, keeping the damage inside a single planned unit of risk.`],
        what_could_improve: win
          ? ["Consider a partial exit with a runner - the move continued past the target."]
          : [`Risk was ${t.risk_percent}% of the account on a setup whose historical hit rate does not support that size.`, "The entry was late relative to the trigger, which pushed the stop further away than planned."],
        biggest_mistake: mistakes[0] ? `${mistakes[0]} - the single clearest departure from the written plan on this trade.` : "",
        best_decision: win ? "Sticking with the position until the planned target rather than exiting on the first pullback." : "Honouring the stop instead of moving it and hoping.",
        rule_adherence: [
          { rule: "Risk no more than 1% of the account", status: t.risk_percent <= 1 ? "followed" : "not_followed", note: `Risked ${t.risk_percent}%.` },
          { rule: "Stop loss recorded before entry", status: "followed", note: `Stop at $${t.stop_loss}.` },
          { rule: "Stop was not moved", status: mistakes.includes("Moved stop") ? "not_followed" : "followed", note: mistakes.includes("Moved stop") ? "Edit history shows the stop was widened after entry." : "No change in the retained history." },
        ],
        emotional_analysis: [
          `Logged "${t.custom_fields.emotion_before?.[0]}" before entry and "${t.custom_fields.emotion_after?.[0]}" after, at intensity ${t.custom_fields.emotion_intensity}/10.`,
          GOOD_EMOTIONS.includes(t.custom_fields.emotion_before?.[0]) ? "The composed pre-entry state matches the higher-performing half of this journal." : "This pre-entry state correlates with a materially lower hit rate across the journal.",
        ],
        action_items: win
          ? ["Repeat this exact sequence: trigger, 1% risk, planned exit.", "Log a screenshot next time so setup quality can be graded, not recalled."]
          : ["Halve the size on this setup until it shows positive expectancy over 20 trades.", "No entries after 14:00 ET.", "Write the exit plan before the entry, not during the trade."],
        missing_information: ["No chart screenshot attached, so entry timing cannot be independently verified."],
      },
    });
  }

  await insertAll("ai_reviews", reviews);

  // ---- report -------------------------------------------------------------
  const closedCount = closed.length;
  const openCount = trades.filter((t) => t.status === "open" && t.mode === "trade").length;
  const pendingCount = trades.filter((t) => t.status === "pending").length;
  const netPl = round2(closed.reduce((s, t) => s + t.dollar_pl, 0));
  const wins = closed.filter((t) => t.dollar_pl > 0).length;
  const deposits = ledger.reduce((s, l) => s + l.amount, 0);
  const activeDays = new Set(closed.map((t) => t.entry_date.slice(0, 10))).size;

  console.log("\n--- demo account seeded ---");
  console.log("email:          ", EMAIL);
  console.log("password:       ", PASSWORD);
  console.log("plan:            paid");
  console.log("timezone:       ", TIMEZONE);
  console.log("closed trades:  ", closedCount, `(${wins} wins, ${Math.round((wins / closedCount) * 100)}% win rate)`);
  console.log("open / pending: ", openCount, "/", pendingCount);
  console.log("investments:    ", trades.filter((t) => t.mode === "investment").length);
  console.log("active days:    ", activeDays, `over ${DAYS} days`);
  console.log("net P&L:        ", money(netPl), `on ${money(deposits)} deposited`);
  console.log("ending balance: ", money(round2(deposits + netPl)));
  console.log("strategies:     ", strategies.length, `(${rules.length} plan rules)`);
  console.log("folders:        ", folderRows.length);
  console.log("edit history:   ", history.length, "snapshots");
  console.log("MAE/MFE rows:   ", excursions.length);
  console.log("AI reviews:     ", reviews.length);
}

await main();
