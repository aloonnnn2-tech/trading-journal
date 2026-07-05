// Seeds a demo account with realistic-looking trades so the UI (trades
// list, analytics, emotions, insights) can be visually reviewed with
// real-shaped data instead of empty states. Run with:
//   node scripts/seed-fake-data.mjs [email] [password]
// If no email/password given, signs up a brand-new demo account first.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=").map((s) => s.trim())),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

let email = process.argv[2];
let password = process.argv[3] ?? "DemoPass123!";

if (!email) {
  email = `demo+${Date.now()}@caliunlock-demo.test`;
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
} else {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

const { data: userData, error: userError } = await supabase.auth.getUser();
if (userError) throw userError;
const userId = userData.user.id;

console.log("Seeding data for:", email, userId);

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000);
}

const TICKERS = [
  { ticker: "AAPL", company: "Apple Inc.", market: "NASDAQ" },
  { ticker: "TSLA", company: "Tesla Inc.", market: "NASDAQ" },
  { ticker: "NVDA", company: "NVIDIA Corp.", market: "NASDAQ" },
  { ticker: "SPY", company: "SPDR S&P 500 ETF", market: "NYSE" },
  { ticker: "AMD", company: "Advanced Micro Devices", market: "NASDAQ" },
  { ticker: "MSFT", company: "Microsoft Corp.", market: "NASDAQ" },
  { ticker: "COIN", company: "Coinbase Global", market: "NASDAQ" },
  { ticker: "BTCUSD", company: null, market: "Crypto" },
];

const STRATEGIES = ["breakout", "pullback", "trend_continuation", "reversal", "fomo_entry"];
const EMOTIONS = ["Calm", "Confident", "Fearful", "FOMO", "Excited", "Hesitant", "Stressed"];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Deliberately biased so insights has something real to detect:
// Monday entries and "Calm" emotion win noticeably more often.
function buildClosedTrade(i) {
  const t = pick(TICKERS);
  const direction = Math.random() > 0.3 ? "long" : "short";
  const entryDate = daysAgo(90 - i * 2.5);
  const isMonday = entryDate.getUTCDay() === 1;
  const emotionBefore = isMonday ? (Math.random() > 0.2 ? "Calm" : pick(EMOTIONS)) : pick(EMOTIONS);
  const calmBoost = emotionBefore === "Calm" ? 0.25 : 0;
  const mondayBoost = isMonday ? 0.2 : 0;
  const winProbability = 0.45 + calmBoost + mondayBoost;
  const won = Math.random() < winProbability;

  const entryPrice = round2(20 + Math.random() * 400);
  const riskPercent = round2(0.3 + Math.random() * 2);
  const rMultiple = won ? round2(0.5 + Math.random() * 2.5) : round2(-(0.5 + Math.random() * 1.5));
  const shares = Math.round(10 + Math.random() * 200);
  const dollarAmount = round2(entryPrice * shares);
  const riskAmount = round2((dollarAmount * riskPercent) / 100);
  const dollarPL = round2(rMultiple * riskAmount);
  const exitPrice = round2(
    direction === "long" ? entryPrice + dollarPL / shares : entryPrice - dollarPL / shares,
  );
  const holdingDays = Math.round(1 + Math.random() * 6);
  const exitDate = new Date(entryDate.getTime() + holdingDays * 86_400_000);

  return {
    user_id: userId,
    mode: "trade",
    ticker: t.ticker,
    company_name: t.company,
    asset_type: t.market === "Crypto" ? "Crypto" : "Stock",
    market: t.market,
    direction,
    status: "closed",
    result: won ? "win" : Math.random() < 0.1 ? "break_even" : "loss",
    entry_price: entryPrice,
    exit_price: exitPrice,
    stop_loss: round2(direction === "long" ? entryPrice * 0.95 : entryPrice * 1.05),
    take_profit: round2(direction === "long" ? entryPrice * 1.1 : entryPrice * 0.9),
    shares,
    position_size: dollarAmount,
    dollar_amount: dollarAmount,
    risk_amount: riskAmount,
    risk_percent: riskPercent,
    entry_date: entryDate.toISOString(),
    exit_date: exitDate.toISOString(),
    dollar_pl: dollarPL,
    percent_return: round2((dollarPL / dollarAmount) * 100),
    r_multiple: rMultiple,
    risk_reward_ratio: round2(Math.abs(rMultiple)),
    custom_fields: {
      strategy_setup: [pick(STRATEGIES)],
      notes_why_entered: "Saw a clean setup matching my plan and took the entry with confirmation from volume.",
      notes_what_right: won ? "Followed the plan, sized correctly, exited at target." : "Stuck to my stop loss instead of moving it.",
      notes_what_change: won ? "Could have held a bit longer for more R." : "Entered too early before full confirmation.",
      notes_lessons_learned: won ? "Patience on entries pays off." : "Avoid entering during high volatility news windows.",
      notes_additional: "",
      emotion_before: [emotionBefore],
      emotion_during: [pick(EMOTIONS)],
      emotion_after: [won ? pick(["Confident", "Calm", "Excited"]) : pick(["Stressed", "Hesitant", "Fearful"])],
      emotion_intensity: Math.round(3 + Math.random() * 7),
    },
  };
}

function buildOpenOrPendingTrade(i, status) {
  const t = pick(TICKERS);
  const direction = Math.random() > 0.5 ? "long" : "short";
  const entryPrice = round2(20 + Math.random() * 400);
  const shares = Math.round(10 + Math.random() * 150);
  const riskPercent = round2(0.5 + Math.random() * 1.5);
  const dollarAmount = round2(entryPrice * shares);

  return {
    user_id: userId,
    mode: "trade",
    ticker: t.ticker,
    company_name: t.company,
    asset_type: t.market === "Crypto" ? "Crypto" : "Stock",
    market: t.market,
    direction,
    status,
    result: "open",
    entry_price: status === "open" ? entryPrice : null,
    stop_loss: round2(direction === "long" ? entryPrice * 0.95 : entryPrice * 1.05),
    take_profit: round2(direction === "long" ? entryPrice * 1.1 : entryPrice * 0.9),
    shares,
    position_size: dollarAmount,
    dollar_amount: dollarAmount,
    risk_amount: round2((dollarAmount * riskPercent) / 100),
    risk_percent: riskPercent,
    entry_date: status === "open" ? daysAgo(Math.random() * 5).toISOString() : null,
    custom_fields: {
      strategy_setup: [pick(STRATEGIES)],
      emotion_before: [pick(EMOTIONS)],
    },
  };
}

const closedTrades = Array.from({ length: 36 }, (_, i) => buildClosedTrade(i));
const openTrades = Array.from({ length: 4 }, (_, i) => buildOpenOrPendingTrade(i, "open"));
const pendingTrades = Array.from({ length: 3 }, (_, i) => buildOpenOrPendingTrade(i, "pending"));

// A couple of investment-mode trades for the Investment Mode UI.
const investmentTrades = [
  {
    user_id: userId,
    mode: "investment",
    ticker: "VOO",
    company_name: "Vanguard S&P 500 ETF",
    asset_type: "ETF",
    market: "NYSE",
    direction: "long",
    status: "open",
    result: "open",
    entry_date: daysAgo(400).toISOString(),
    custom_fields: {
      average_cost: 380.5,
      current_price: 512.2,
      total_shares: 25,
      total_value: 12805,
      unrealized_gain_loss: 3292.5,
      dividend_yield: 1.3,
      long_term_notes: "Core long-term holding, dollar-cost-averaging monthly.",
    },
  },
  {
    user_id: userId,
    mode: "investment",
    ticker: "BTCUSD",
    company_name: null,
    asset_type: "Crypto",
    market: "Crypto",
    direction: "long",
    status: "open",
    result: "open",
    entry_date: daysAgo(200).toISOString(),
    custom_fields: {
      average_cost: 42000,
      current_price: 67500,
      total_shares: 0.35,
      total_value: 23625,
      unrealized_gain_loss: 8925,
      dividend_yield: 0,
      long_term_notes: "Holding as a long-term speculative position.",
    },
  },
];

const allTrades = [...closedTrades, ...openTrades, ...pendingTrades, ...investmentTrades];

const { error: insertError } = await supabase.from("trades").insert(allTrades);
if (insertError) throw insertError;

console.log(`Inserted ${allTrades.length} trades (${closedTrades.length} closed, ${openTrades.length} open, ${pendingTrades.length} pending, ${investmentTrades.length} investment).`);

// A couple of folders, with a handful of trades assigned to each.
const { data: folders, error: folderError } = await supabase
  .from("folders")
  .insert([
    { user_id: userId, name: "Swing Trades" },
    { user_id: userId, name: "Day Trades" },
  ])
  .select();
if (folderError) throw folderError;

const { data: tradeIds, error: tradeIdsError } = await supabase
  .from("trades")
  .select("id")
  .eq("user_id", userId)
  .limit(10);
if (tradeIdsError) throw tradeIdsError;

const folderLinks = tradeIds.slice(0, 5).map((t) => ({ trade_id: t.id, folder_id: folders[0].id }));
folderLinks.push(...tradeIds.slice(5, 10).map((t) => ({ trade_id: t.id, folder_id: folders[1].id })));

const { error: linkError } = await supabase.from("trade_folders").insert(folderLinks);
if (linkError) throw linkError;

console.log("Created folders:", folders.map((f) => f.name).join(", "));
console.log("\nDemo account ready:");
console.log("  email:   ", email);
console.log("  password:", password);
console.log("  Sign in at /sign-in to view the seeded data.");
