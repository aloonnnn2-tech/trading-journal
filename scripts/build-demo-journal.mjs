// Builds src/lib/demo/journal.json: the demo journal a new account can start
// with (Phase 4D of docs/design-audit.md).
//
//   node scripts/build-demo-journal.mjs
//
// Run by hand, not by the app, and committed. The app seeds from the JSON.
//
// **Real prices, on purpose.** The old demo seed (seed-demo-account.mjs)
// invents prices with a random walk, so since Phase 4C every one of its charts
// says "Entry is outside the range" -- TSLA at $234 on a day it traded $350.
// This script places every entry and exit INSIDE a real Yahoo bar at that
// moment, so the demo's charts line up: the markers sit on real candles and no
// mismatch note appears. Stops and targets are then simulated forward through
// the real bars that followed, so each exit is where that plan would actually
// have closed.
//
// Dates stay the real historical ones -- the prices belong to them. The demo
// ages; rerun this to refresh it. Deterministic for a given run date (seeded
// RNG), so reruns on the same day produce the same journal.
//
// Each trade carries `check`: the high/low of its entry and exit bars as
// fetched, which src/lib/demo/journal.test.ts uses to prove every fill sits on
// its bar.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "demo", "journal.json");
const ZONE = "America/New_York";
const ACCOUNT = 25_000;
const TARGET_TRADES = 60;

const SYMBOLS = {
  AAPL: { company: "Apple Inc.", market: "NASDAQ", assetType: "Stock" },
  MSFT: { company: "Microsoft Corp.", market: "NASDAQ", assetType: "Stock" },
  NVDA: { company: "NVIDIA Corp.", market: "NASDAQ", assetType: "Stock" },
  TSLA: { company: "Tesla Inc.", market: "NASDAQ", assetType: "Stock" },
  AMD: { company: "Advanced Micro Devices", market: "NASDAQ", assetType: "Stock" },
  META: { company: "Meta Platforms", market: "NASDAQ", assetType: "Stock" },
  SPY: { company: "SPDR S&P 500 ETF", market: "NYSE", assetType: "ETF" },
  QQQ: { company: "Invesco QQQ Trust", market: "NASDAQ", assetType: "ETF" },
};

const STRATEGIES = [
  {
    key: "orb",
    name: "Opening Range Breakout",
    description: "Long the break of the first 15 minutes' high, on volume, with the market holding its own opening range.",
    color: "#3b82f6",
    rules: [
      { label: "Risk no more than 1% of the account", subject_source: "core", subject_key: "risk_percent", operator: "lte", number_value: 1 },
      { label: "Stop loss recorded before entry", subject_source: "core", subject_key: "stop_loss", operator: "is_set" },
      { label: "Planned R:R at least 1.5", subject_source: "core", subject_key: "risk_reward_ratio", operator: "gte", number_value: 1.5 },
      { label: "Long side only", subject_source: "core", subject_key: "direction", operator: "text_eq", text_value: "long" },
      { label: "Stop was not moved", subject_source: "derived", subject_key: "stop_moved", operator: "is_false" },
    ],
  },
  {
    key: "vwap",
    name: "VWAP Reclaim",
    description: "Midday reclaim (or loss) of VWAP after a flush, either direction, out by the close.",
    color: "#10b981",
    rules: [
      { label: "Risk no more than 0.75% of the account", subject_source: "core", subject_key: "risk_percent", operator: "lte", number_value: 0.75 },
      { label: "Stop loss recorded before entry", subject_source: "core", subject_key: "stop_loss", operator: "is_set" },
      { label: "Closed the same session", subject_source: "derived", subject_key: "holding_days", operator: "lte", number_value: 1 },
    ],
  },
  {
    key: "pullback",
    name: "Trend Pullback",
    description: "Buy the first pullback in an established uptrend; hold for days, not hours.",
    color: "#f59e0b",
    rules: [
      { label: "Risk no more than 1% of the account", subject_source: "core", subject_key: "risk_percent", operator: "lte", number_value: 1 },
      { label: "Planned R:R at least 2", subject_source: "core", subject_key: "risk_reward_ratio", operator: "gte", number_value: 2 },
      { label: "Hold no longer than 10 sessions", subject_source: "derived", subject_key: "holding_days", operator: "lte", number_value: 10 },
      { label: "Emotion logged before entry", subject_source: "custom", subject_key: "emotion_before", operator: "is_set" },
    ],
  },
];

// ---- deterministic randomness ------------------------------------------------
let seed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ""));
function rand() {
  // mulberry32
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a, b) => a + rand() * (b - a);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const round2 = (n) => Math.round(n * 100) / 100;

// ---- market data ---------------------------------------------------------------
const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const etDay = (t) => dayFormatter.format(new Date(t * 1000));
const etMinutes = (t) => {
  const [h, m] = timeFormatter.format(new Date(t * 1000)).split(":").map(Number);
  return h * 60 + m;
};

async function fetchBars(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`${symbol} ${interval}: HTTP ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(`${symbol} ${interval}: no result`);
  const q = r.indicators.quote[0];
  const bars = [];
  r.timestamp.forEach((time, i) => {
    if ([q.open[i], q.high[i], q.low[i], q.close[i]].some((v) => v == null)) return;
    // Regular session only: 09:30-16:00 New York.
    const m = etMinutes(time);
    if (m < 570 || m >= 960) return;
    bars.push({ time, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] });
  });
  return bars;
}

function bySession(bars) {
  const days = new Map();
  for (const b of bars) {
    const d = etDay(b.time);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(b);
  }
  return days;
}

// ---- simulation ----------------------------------------------------------------
/** Walks forward from `from` (exclusive) until the stop or target is touched,
 *  or `lastIndex` is reached. Returns the exit bar and price. Both touched in
 *  one bar counts as the stop: the conservative reading of a bar we can't see
 *  inside. */
function simulate(bars, from, lastIndex, direction, stop, target) {
  const long = direction === "long";
  for (let i = from + 1; i <= lastIndex; i++) {
    const b = bars[i];
    const hitStop = long ? b.low <= stop : b.high >= stop;
    const hitTarget = long ? b.high >= target : b.low <= target;
    if (hitStop) {
      // A gap through the stop fills at the open, not the stop.
      const price = long ? Math.min(stop, b.open) : Math.max(stop, b.open);
      return { index: i, price, how: "stop" };
    }
    if (hitTarget) {
      const price = long ? Math.max(target, b.open) : Math.min(target, b.open);
      return { index: i, price, how: "target" };
    }
  }
  return { index: lastIndex, price: bars[lastIndex].close, how: "time" };
}

// ---- prose ----------------------------------------------------------------------
const WHY = {
  orb: [
    "{T} built a tight first 15 minutes on heavy volume. Took the break of the range high with the index holding its own opening range.",
    "Opening drive on {T}, first pullback held the range midpoint. Entered on the reclaim of the high.",
  ],
  vwap: [
    "{T} flushed into late morning, then reclaimed VWAP with volume picking up. Entry on the first hold above it.",
    "Midday fade on {T} lost VWAP and failed the retest. Took it with the sector weak.",
  ],
  pullback: [
    "{T} in a clean uptrend, pulled back to the rising 20-day on light volume. Bought the first higher low.",
    "Three-day pullback in {T} into prior breakout level. Entry as it turned up with the market steady.",
  ],
};
const RIGHT = { win: ["Waited for the level instead of anticipating it.", "Sized to the plan and let it work."], loss: ["Took the stop where the plan said, no hesitation.", "Kept the loss to the planned 1R."] };
const CHANGE = { win: ["Could have scaled the last third instead of closing it all.", "Entry was a little late; the setup was obvious a bar earlier."], loss: ["The market wasn't confirming; should have waited for it.", "Skip this setup on low-volume days."] };
const LESSON = { win: ["When the setup is clean, the plan does the work.", "Patience at the level pays."], loss: ["A good process still loses sometimes; the size kept it small.", "No confirmation, no trade."] };

// ---- build ----------------------------------------------------------------------
async function main() {
  const now = Math.floor(Date.now() / 1000);
  const intraday = {};
  const hourly = {};
  for (const s of Object.keys(SYMBOLS)) {
    intraday[s] = bySession(await fetchBars(s, "5m", "60d"));
    hourly[s] = await fetchBars(s, "60m", "6mo");
    process.stdout.write(`${s} `);
  }
  console.log();

  // Sessions old enough to be settled, recent enough for 5-minute data to
  // still exist when the demo is first used.
  const sessions = [...intraday.SPY.keys()].sort().filter((d) => d < etDay(now - 86_400)).slice(-45);

  const candidates = [];
  for (const day of sessions) {
    for (const ticker of Object.keys(SYMBOLS)) {
      const bars = intraday[ticker].get(day);
      if (!bars || bars.length < 70) continue;
      const early = bars.slice(0, 12);
      const avgRange = early.reduce((a, b) => a + (b.high - b.low), 0) / early.length;

      // Opening Range Breakout: long, entry 09:45-10:10.
      {
        const i = 3 + Math.floor(rand() * 6);
        const entry = bars[i].close;
        const dist = Math.max(entry * 0.003, avgRange * between(2.2, 3.2));
        const r = between(1.8, 2.6);
        candidates.push({ strategy: "orb", ticker, day, bars, i, direction: "long", entry, dist, r, last: bars.length - 2 });
      }
      // VWAP Reclaim: either side, entry 10:30-13:30.
      {
        const i = 12 + Math.floor(rand() * 36);
        const entry = bars[i].close;
        const dist = Math.max(entry * 0.0025, avgRange * between(1.8, 2.6));
        const r = between(1.5, 2.2);
        candidates.push({ strategy: "vwap", ticker, day, bars, i, direction: chance(0.55) ? "long" : "short", entry, dist, r, last: bars.length - 2 });
      }
    }
  }

  // Trend Pullback: swing longs on hourly bars, entered in the same window.
  for (const ticker of Object.keys(SYMBOLS)) {
    const bars = hourly[ticker];
    for (let k = 0; k < 6; k++) {
      const day = pick(sessions.slice(0, -10));
      const idx = bars.findIndex((b) => etDay(b.time) === day);
      if (idx < 0) continue;
      const i = idx + Math.floor(rand() * 5);
      const entry = bars[i].close;
      const dist = entry * between(0.02, 0.035);
      const holdSessions = 2 + Math.floor(rand() * 7);
      const last = Math.min(bars.length - 1, i + holdSessions * 7);
      if (bars[last].time > now - 86_400) continue;
      candidates.push({ strategy: "pullback", ticker, day, bars, i, direction: "long", entry, dist, r: between(2, 3), last, swing: true });
    }
  }

  const built = candidates.map(build).filter(Boolean);
  // A believable mix rather than whatever the market did: about 52% winners,
  // spread over the sessions, a few more day trades than swings.
  const wins = shuffle(built.filter((t) => t.pl > 0));
  const losses = shuffle(built.filter((t) => t.pl <= 0));
  const swings = (list) => list.filter((t) => t.strategy === "pullback");
  const days = (list) => list.filter((t) => t.strategy !== "pullback");
  const take = (list, n) => list.slice(0, n);
  const nWin = Math.round(TARGET_TRADES * 0.52);
  const nLoss = TARGET_TRADES - nWin;
  const chosen = [
    ...take(swings(wins), 6), ...take(days(wins), nWin - Math.min(6, swings(wins).length)),
    ...take(swings(losses), 5), ...take(days(losses), nLoss - Math.min(5, swings(losses).length)),
  ].sort((a, b) => a.row.entry_date.localeCompare(b.row.entry_date));

  // A few of each mistake, whatever the draw gave: the Mistakes and plan
  // adherence panels need something to show. Rebuilt from the same bars, so
  // the moved stop's wider loss and the early exit's smaller win are real.
  const count = (m) => chosen.filter((t) => t.row.custom_fields.trade_mistakes.includes(m)).length;
  for (const t of shuffle(chosen.filter((t) => t.strategy !== "pullback" && t.how === "stop"))) {
    if (count("Moved stop") >= 3) break;
    const rebuilt = build(t.source, { moved: true, early: false });
    if (rebuilt) chosen[chosen.indexOf(t)] = { ...rebuilt, key: t.key };
  }
  for (const t of shuffle(chosen.filter((t) => t.how === "target"))) {
    if (count("Exited too early") >= 2) break;
    const rebuilt = build(t.source, { moved: false, early: true });
    if (rebuilt && rebuilt.how === "early") chosen[chosen.indexOf(t)] = { ...rebuilt, key: t.key };
  }

  const firstDeposit = new Date((Date.parse(chosen[0].row.entry_date) / 1000 - 3 * 86_400) * 1000).toISOString();

  const journal = {
    generatedAt: new Date().toISOString(),
    source: "Yahoo Finance chart bars (5m, 60m), regular session",
    account: { deposit: ACCOUNT, depositNote: "Starting balance", depositAt: firstDeposit },
    strategies: STRATEGIES,
    trades: chosen.map(({ key, strategy, row, history, check }) => ({ key, strategy, row, history, check })),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(journal, null, 2) + "\n");
  const pl = chosen.reduce((a, t) => a + t.pl, 0);
  console.log(`${chosen.length} trades (${chosen.filter((t) => t.pl > 0).length} wins), net ${round2(pl)} -> ${OUT}`);
}

let counter = 0;
function build(c, force = {}) {
  const { bars, i, direction, entry: rawEntry, dist, r, last, strategy, ticker } = c;
  const long = direction === "long";
  const sign = long ? 1 : -1;
  const entry = round2(rawEntry);
  const moved = force.moved ?? (strategy !== "pullback" && chance(0.04));
  const oversized = chance(0.05);
  const earlyExit = force.early ?? chance(0.12);

  let stop = round2(entry - sign * dist);
  const target = round2(entry + sign * dist * r);
  const originalStop = stop;
  // A moved stop: widened after entry, which is the mistake.
  if (moved) stop = round2(entry - sign * dist * between(1.4, 1.8));

  let exit = simulate(bars, i, last, direction, stop, target);
  // An early exit: a winner closed at the first bar close past +1R, before
  // the target it later reached.
  if (earlyExit && exit.how === "target") {
    for (let k = i + 1; k < exit.index; k++) {
      if ((bars[k].close - entry) * sign >= dist) {
        exit = { index: k, price: bars[k].close, how: "early" };
        break;
      }
    }
  }

  const riskPercent = oversized ? between(1.3, 1.6) : between(0.45, 0.95);
  // Sized to the risk, then capped by buying power: 4x the account intraday
  // (a margin account's day-trading limit), 1x for a position held overnight.
  const maxShares = Math.floor((ACCOUNT * (c.swing ? 1 : 4)) / entry);
  const shares = Math.max(1, Math.min(maxShares, Math.floor((ACCOUNT * riskPercent) / 100 / dist)));
  const exitPrice = round2(exit.price);
  const riskAmount = round2(Math.abs(entry - stop) * shares);
  const pl = (exitPrice - entry) * shares * sign;
  const won = pl > 0;

  const entryBar = bars[i];
  const exitBar = bars[exit.index];
  // Fills are the bar's CLOSE, so they're timed near the bar's end: the
  // chart's intraday bars include pre-market and so start on the hour, and an
  // hourly fill stamped early in a 09:30 bar would land in the chart's 09:00
  // bar, whose range needn't contain a 10:30 price.
  const entryAt = new Date((entryBar.time + 60 * (c.swing ? 55 : 4)) * 1000).toISOString();
  const exitAt = new Date((exitBar.time + 60 * (c.swing ? 55 : 4)) * 1000).toISOString();

  const mistakes = [];
  if (moved) mistakes.push("Moved stop");
  if (exit.how === "early") mistakes.push("Exited too early");
  if (oversized) mistakes.push("Oversized");

  const info = SYMBOLS[ticker];
  const emotionBefore = pick(won ? ["Calm", "Confident", "Calm"] : ["Calm", "Hesitant", "FOMO", "Confident"]);
  const key = `t${++counter}`;
  return {
    key,
    strategy,
    pl,
    how: exit.how,
    source: c,
    row: {
      mode: "trade",
      ticker,
      company_name: info.company,
      asset_type: info.assetType,
      market: info.market,
      direction,
      status: "closed",
      order_type: "market",
      entry_price: entry,
      exit_price: exitPrice,
      stop_loss: stop,
      take_profit: target,
      shares,
      position_size: round2(entry * shares),
      dollar_amount: round2(entry * shares),
      risk_amount: riskAmount,
      risk_percent: round2((riskAmount / ACCOUNT) * 100),
      entry_date: entryAt,
      exit_date: exitAt,
      custom_fields: {
        notes_why_entered: pick(WHY[strategy]).replace("{T}", ticker),
        notes_what_right: pick(won ? RIGHT.win : RIGHT.loss),
        notes_what_change: pick(won ? CHANGE.win : CHANGE.loss),
        notes_lessons_learned: pick(won ? LESSON.win : LESSON.loss),
        notes_additional: mistakes.length ? `Flagged: ${mistakes.join(", ")}.` : "",
        emotion_before: [emotionBefore],
        emotion_during: [pick(won ? ["Calm", "Confident"] : ["Stressed", "Hesitant", "Calm"])],
        emotion_after: [pick(won ? ["Confident", "Calm"] : ["Stressed", "Calm", "Hesitant"])],
        emotion_intensity: won ? 3 + Math.floor(rand() * 4) : 5 + Math.floor(rand() * 5),
        trade_mistakes: mistakes,
      },
    },
    history: moved
      ? [{
          created_at: new Date((entryBar.time + 60 * 12) * 1000).toISOString(),
          snapshot: { ticker, status: "open", direction, entry_price: entry, exit_price: null, stop_loss: originalStop, take_profit: target, shares, entry_date: entryAt },
        }]
      : [],
    check: {
      entryBar: { time: entryBar.time, low: entryBar.low, high: entryBar.high },
      exitBar: { time: exitBar.time, low: exitBar.low, high: exitBar.high },
    },
  };
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
