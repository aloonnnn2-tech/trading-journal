"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  ColorType,
  LineStyle,
  type AutoscaleInfoProvider,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { Card } from "@/components/ui/Card";
import type { Candle, CandlesResponse } from "@/app/api/market-data/candles/route";
import { guessYahooSymbol } from "@/lib/market-data/yahoo";
import type { BarsResponse } from "@/app/api/market-data/bars/route";
import {
  chooseBars,
  DEFAULT_TIMEFRAME,
  fitRange,
  formatBarTime,
  formatQuote,
  formatQuoteAge,
  isCalendarInterval,
  locate,
  priceMismatch,
  timeframeAvailability,
  TIMEFRAME_LABELS,
  TIMEFRAMES,
  tradeMarkers,
  visibleRange,
  type BarInterval,
  zoneOffset,
  tradeMoment,
  candleMoment,
} from "@/lib/market-data/trade-window";

const inputClass =
  "rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary font-mono";

// How often to re-poll while watching for an auto-execution trigger. The
// server response is itself cached for 300s (see the candles route), so
// this doesn't hammer Yahoo -- it just controls how quickly the UI (and
// the auto-execution check) notices a price move that already landed in
// that cache.
const WATCH_POLL_MS = 60_000;

export interface PriceSnapshot {
  currentPrice: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  quoteTime: Date | null;
}

function overrideKey(ticker: string) {
  return `price_chart_symbol_override:${ticker.trim().toUpperCase()}`;
}

// Shared with the scheduled auto-execution job so both resolve symbols the
// same way -- see the doc comment on guessYahooSymbol.
const guessSymbol = guessYahooSymbol;

// Single chart combining what used to be two: real daily candles (fetched
// server-side from Yahoo Finance via /api/market-data/candles) plus
// Entry/Stop Loss/Take Profit drawn as horizontal price lines. There's no
// live TradingView embed anymore -- that widget is a locked third-party
// iframe with no supported way to draw custom lines on it, so getting
// auto-drawn lines meant owning the whole chart instead.
//
// Phase 4C (issue 5 of docs/design-audit.md): a trade with an entry date
// opens on its holding period -- a few bars either side of entry to exit, in
// a bar size that suits the hold -- with ▲/▼ markers on the entry and exit
// bars, and a price scale that always keeps its own levels in view. When the
// trade's price isn't on the market's bar for that moment, the chart says so
// and scales to the trade instead. See src/lib/market-data/trade-window.ts.
// Without an entry date (a new or pending trade) it shows the two-year daily
// history as before.
export function PriceChart({
  ticker,
  assetType,
  entryPrice,
  stopLoss,
  takeProfit,
  exitPrice = null,
  entryDate = null,
  exitDate = null,
  direction = null,
  breakevenPrice = null,
  watchForAutoExecution = false,
  onPriceUpdate,
  onPickCandle,
}: {
  ticker: string;
  assetType: string | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  exitPrice?: number | null;
  /** ISO timestamps. With an entry date the chart opens on the holding
   *  period; without one it shows the two-year daily history. */
  entryDate?: string | null;
  exitDate?: string | null;
  direction?: "long" | "short" | null;
  /** Price at which the trade clears its full round-trip commission -- sits
   *  past the entry line, and is where profit actually begins. Null when no
   *  commission rule applies. */
  breakevenPrice?: number | null;
  /** When true, re-polls the price on an interval (see WATCH_POLL_MS) and
   *  calls `onPriceUpdate` after every fetch -- the caller decides whether
   *  that update should trigger an auto-execution. When false, price is
   *  still fetched once for display but never re-polled. */
  watchForAutoExecution?: boolean;
  onPriceUpdate?: (snapshot: PriceSnapshot) => void;
  /**
   * Set when the trader may correct which candle the trade entered or exited
   * on: a click on a candle offers "Set as entry / exit candle", and this
   * gets the date to save (candleMoment in trade-window.ts).
   */
  onPickCandle?: (which: "entry" | "exit", date: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const { resolvedTheme } = useTheme();
  const [symbol, setSymbol] = useState("");
  const [draft, setDraft] = useState("");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  // "not-found": Yahoo has no such symbol. "unavailable": Yahoo is down or
  // slow (the route answers 503) -- not the symbol's fault, so the message
  // must not tell the user to correct it.
  const [failed, setFailed] = useState<false | "not-found" | "unavailable">(false);
  // Yahoo's own time for the last price, shown beside it: a price can be
  // minutes old (delayed quotes, the 5-minute server cache) and must never
  // read as live when it isn't.
  const [quoteTime, setQuoteTime] = useState<Date | null>(null);

  // Kept current via an effect (not read directly) so the polling effect
  // below doesn't need `onPriceUpdate` itself in its dependency array --
  // that prop is a fresh arrow function on every TradeCard render, which
  // would otherwise tear down and restart the poll interval constantly.
  const onPriceUpdateRef = useRef(onPriceUpdate);
  useEffect(() => {
    onPriceUpdateRef.current = onPriceUpdate;
  }, [onPriceUpdate]);

  // The candle the trader clicked, waiting for "entry" or "exit".
  const canPick = Boolean(onPickCandle);
  const [picked, setPicked] = useState<number | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  // Ticker/asset type update on every keystroke while editing the trade
  // form, but re-fetching candles and rebuilding the chart is expensive.
  // Debounce so it only happens after typing pauses, matching the app's
  // existing 600ms autosave cadence.
  const [debouncedTicker, setDebouncedTicker] = useState(ticker);
  const [debouncedAssetType, setDebouncedAssetType] = useState(assetType);
  // The dates too: they come off the same form, and each change refetches.
  const [debouncedDates, setDebouncedDates] = useState({ entry: entryDate, exit: exitDate });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTicker(ticker);
      setDebouncedAssetType(assetType);
      setDebouncedDates((prev) =>
        prev.entry === entryDate && prev.exit === exitDate ? prev : { entry: entryDate, exit: exitDate },
      );
    }, 600);
    return () => clearTimeout(timer);
  }, [ticker, assetType, entryDate, exitDate]);

  useEffect(() => {
    // localStorage isn't available during SSR, so the saved override has to
    // be read here rather than computed during render.
    const saved = window.localStorage.getItem(overrideKey(debouncedTicker));
    const resolved = saved ?? guessSymbol(debouncedTicker, debouncedAssetType);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSymbol(resolved);
    setDraft(resolved);
  }, [debouncedTicker, debouncedAssetType]);

  // Tracks which symbol's in-flight fetches are still "current," so a
  // response from a superseded symbol can't land after the user has since
  // changed tickers. A ref (not the `cancelled`-closure-per-effect pattern)
  // because `load` below is now shared across two effects instead of being
  // defined fresh inside one -- see the split below for why.
  const activeSymbolRef = useRef(symbol);
  // Which data the series holds, so a price poll knows whether its daily bar
  // belongs on it (4C: the holding-period view may be intraday).
  const sourceRef = useRef<"daily" | "holding">("daily");

  const load = useCallback(
    (isPoll: boolean) => {
      if (!symbol) return;
      fetch(`/api/market-data/candles?ticker=${encodeURIComponent(symbol)}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then((data: CandlesResponse) => {
          if (activeSymbolRef.current !== symbol) return;
          if (isPoll) {
            // Deliberately NOT setCandles() here. Every fetch returns a
            // brand-new array, and the chart-building effect below keys on
            // `candles` -- so storing it would destroy and recreate the
            // whole chart (and call fitContent(), throwing away whatever
            // the user had zoomed/panned to) on every single poll. Pushing
            // just the latest bar through the series API updates the chart
            // in place instead; `update()` replaces the last bar or appends
            // a new one depending on its timestamp, so it handles both an
            // intraday tick and the roll into a new day.
            const latest = data.candles[data.candles.length - 1];
            // Not onto the holding-period view: its bars may be intraday, and
            // a daily bar appended there would be a bar of the wrong size.
            if (latest && seriesRef.current && sourceRef.current === "daily") {
              seriesRef.current.update({
                time: latest.time,
                open: latest.open,
                high: latest.high,
                low: latest.low,
                close: latest.close,
              });
            }
          } else {
            setCandles(data.candles);
          }
          setCurrentPrice(data.currentPrice);
          setQuoteTime(data.quoteTime ? new Date(data.quoteTime) : null);
          setFailed(false);
          onPriceUpdateRef.current?.({
            currentPrice: data.currentPrice,
            dayHigh: data.dayHigh,
            dayLow: data.dayLow,
            quoteTime: data.quoteTime ? new Date(data.quoteTime) : null,
          });
        })
        .catch((err: unknown) => {
          // A failed poll leaves the last-known price/chart on screen
          // rather than blanking a working chart over a transient hiccup;
          // only a fresh symbol's failed initial load says so. A 503 is
          // Yahoo being down, which a network error (no Response) also is.
          if (activeSymbolRef.current === symbol && !isPoll) {
            const status = err instanceof Response ? err.status : null;
            setFailed(status === 404 ? "not-found" : "unavailable");
          }
        });
    },
    [symbol],
  );

  // Loads from scratch only when the symbol itself actually changes.
  useEffect(() => {
    activeSymbolRef.current = symbol;
    if (!symbol) return;
    // Resetting to a loading state for a genuinely new symbol, not
    // mirroring a prop -- same pattern (and same justified exemption) as
    // the symbol-resolution effect above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCandles(null);
    setCurrentPrice(null);
    setQuoteTime(null);
    setFailed(false);
    load(false);
  }, [symbol, load]);

  // ---- The holding period (4C) ------------------------------------------
  //
  // "none" without an entry date, "loading" until the bars arrive, then
  // "ready" -- or "failed", which falls back to the daily history above.
  const [holding, setHolding] = useState<
    | { state: "none" | "loading" | "failed" }
    | { state: "ready"; data: BarsResponse }
  >({ state: "none" });
  // The bar size the user picked: daily until they choose another.
  const [timeframe, setTimeframe] = useState<BarInterval>(DEFAULT_TIMEFRAME);
  // Set when the picked size had no bars and daily is shown instead.
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  // Each size is fetched once per trade and symbol, so switching back and
  // forth doesn't spend price lookups.
  const barsCache = useRef(new Map<string, BarsResponse>());
  // When the chart opened: Yahoo's limits are in days, so this is current
  // enough to decide which sizes an older trade can still be shown in.
  const [openedAt] = useState(() => Date.now() / 1000);

  useEffect(() => {
    const entry = debouncedDates.entry ? Date.parse(debouncedDates.entry) / 1000 : NaN;
    if (!symbol || !Number.isFinite(entry)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHolding({ state: "none" });
      return;
    }
    const exitParsed = debouncedDates.exit ? Date.parse(debouncedDates.exit) / 1000 : NaN;
    const exit = Number.isFinite(exitParsed) ? exitParsed : null;
    const now = Date.now() / 1000;
    let cancelled = false;
    setHolding({ state: "loading" });

    const fetchBars = (interval: BarInterval) => {
      const key = `${symbol}|${entry}|${exit}|${interval}`;
      const hit = barsCache.current.get(key);
      if (hit) return Promise.resolve(hit);
      const req = chooseBars(entry, exit, now, interval);
      const qs = new URLSearchParams({
        ticker: symbol,
        interval: req.interval,
        period1: String(req.period1),
        period2: String(req.period2),
      });
      return fetch(`/api/market-data/bars?${qs}`)
        .then((res) => (res.ok ? (res.json() as Promise<BarsResponse>) : Promise.reject(res)))
        .then((data) => {
          barsCache.current.set(key, data);
          return data;
        });
    };

    // A size this trade is too old for never gets asked: the button is
    // disabled, but a stale pick (the dates were just edited) lands here.
    const picked = timeframeAvailability(timeframe, entry, now).ok ? timeframe : DEFAULT_TIMEFRAME;
    setFallbackNote(null);
    fetchBars(picked)
      // Some symbols have daily history but no intraday (or weekly) bars on
      // Yahoo: say so, and show daily rather than nothing.
      .catch((err) => {
        if (picked === DEFAULT_TIMEFRAME) throw err;
        return fetchBars(DEFAULT_TIMEFRAME).then((data) => {
          if (!cancelled) {
            setFallbackNote(`Yahoo has no ${TIMEFRAME_LABELS[picked].long} bars for ${symbol} around this trade, so this is the daily chart.`);
          }
          return data;
        });
      })
      .then((data) => {
        if (!cancelled) setHolding({ state: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setHolding({ state: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, debouncedDates, timeframe]);

  // Which sizes this trade can be shown in (Yahoo drops old intraday bars).
  const availability = useMemo(() => {
    const entry = debouncedDates.entry ? Date.parse(debouncedDates.entry) / 1000 : NaN;
    if (!Number.isFinite(entry)) return null;
    return TIMEFRAMES.map((interval) => ({ interval, ...timeframeAvailability(interval, entry, openedAt) }));
  }, [debouncedDates, openedAt]);

  // Where the trade sits on those bars. Everything here is a pure function of
  // the bars and the trade -- see trade-window.ts for each rule.
  const holdingView = useMemo(() => {
    if (holding.state !== "ready") return null;
    const { bars, timeZone, interval } = holding.data;
    // tradeMoment: a date with no time of day means that calendar day on
    // the exchange, not midnight UTC (the evening before, in New York).
    const at = (iso: string | null) => {
      const moment = tradeMoment(iso, timeZone);
      return moment != null ? locate(bars, moment, interval, timeZone) : { index: -1, inside: false };
    };
    const entry = at(debouncedDates.entry);
    const exit = at(debouncedDates.exit);
    return {
      bars,
      timeZone,
      interval,
      range: visibleRange(bars, entry.index, exit.index),
      markers: tradeMarkers(bars, entry.index, exit.index, direction),
      mismatch: priceMismatch(bars, { entryPrice, entry, exitPrice, exit }),
    };
  }, [holding, debouncedDates, direction, entryPrice, exitPrice]);

  // The price scale keeps the trade's own levels in view: read through refs
  // by the series' autoscale provider, so a keystroke in the form rescales
  // without rebuilding the chart.
  const levelsRef = useRef<(number | null)[]>([]);
  const mismatchRef = useRef(false);
  // Declared before the chart effects below, so they read current values.
  const hasMismatch = holdingView?.mismatch != null;
  useEffect(() => {
    levelsRef.current = [entryPrice, stopLoss, takeProfit, breakevenPrice, exitPrice];
    mismatchRef.current = hasMismatch;
  }, [entryPrice, stopLoss, takeProfit, breakevenPrice, exitPrice, hasMismatch]);
  const autoscale = useCallback<AutoscaleInfoProvider>((original) => {
    const base = original();
    const barRange = base?.priceRange ? { min: base.priceRange.minValue, max: base.priceRange.maxValue } : null;
    const fit = fitRange(barRange, levelsRef.current, mismatchRef.current);
    if (!fit) return base;
    return { priceRange: { minValue: fit.min, maxValue: fit.max }, margins: base?.margins };
  }, []);

  // Polling lives in its own effect, deliberately *not* depending on
  // anything about the fetched data -- only on whether there's something to
  // watch for. Auto-execution firing changes `watchForAutoExecution` (e.g.
  // a filled entry no longer needs watching until a stop/target exists), and
  // that used to be a dependency of the effect above too: flipping it tore
  // down and reloaded the whole chart from scratch right after execution,
  // blanking a chart the user was mid-look-at. Now it only starts/stops the
  // interval.
  useEffect(() => {
    if (!symbol || !watchForAutoExecution) return;
    // Not while the tab is hidden: nobody is looking, and each poll is a
    // Yahoo request against this app's shared ceiling.
    const interval = setInterval(() => {
      if (!document.hidden) load(true);
    }, WATCH_POLL_MS);
    return () => clearInterval(interval);
  }, [symbol, watchForAutoExecution, load]);

  // Holding-period bars once they're in; the daily history otherwise (no
  // entry date, or the bars couldn't be fetched).
  const waitingForHolding = holding.state === "loading";
  const useHolding = holdingView !== null && holdingView.bars.length > 0;

  useEffect(() => {
    if (!containerRef.current || waitingForHolding) return;
    if (!useHolding && (!candles || candles.length === 0)) return;
    const dark = resolvedTheme !== "light";

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: dark ? "rgba(26, 26, 25, 1)" : "rgba(253, 253, 252, 1)" },
        textColor: dark ? "rgba(228, 228, 224, 0.9)" : "rgba(28, 27, 24, 0.9)",
      },
      grid: {
        vertLines: { color: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(28, 27, 24, 0.06)" },
        horzLines: { color: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(28, 27, 24, 0.06)" },
      },
      // Intraday bars need their time of day on the axis.
      timeScale: { borderVisible: false, timeVisible: useHolding && !isCalendarInterval(holdingView.interval) },
      rightPriceScale: { borderVisible: false },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      autoscaleInfoProvider: autoscale,
    });

    if (useHolding) {
      // Shifted by the exchange's offset so the axis reads in the market's
      // own time (the chart library labels UTC).
      const shift = (t: number) => (t + zoneOffset(holdingView.timeZone, t)) as UTCTimestamp;
      series.setData(holdingView.bars.map((b) => ({ time: shift(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
      createSeriesMarkers(
        series,
        holdingView.markers.map((m) => ({
          time: shift(m.time),
          position: m.position,
          shape: m.shape,
          text: m.text,
          color: dark ? "#e4e4e0" : "#1c1b18",
        })),
      );
      sourceRef.current = "holding";
    } else if (candles) {
      series.setData(candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
      sourceRef.current = "daily";
    }
    seriesRef.current = series;

    if (useHolding && holdingView.range) {
      chart.timeScale().setVisibleLogicalRange({ from: holdingView.range.from - 0.5, to: holdingView.range.to + 0.5 });
    } else {
      chart.timeScale().fitContent();
    }

    // A click (or tap) on a holding-period candle offers to make it the
    // entry or exit candle. The index comes from the logical position, never
    // from param.time -- that has been shifted to the exchange's clock above.
    if (useHolding && canPick) {
      const count = holdingView.bars.length;
      chart.subscribeClick((param) => {
        if (param.logical == null) return;
        const index = Math.round(param.logical);
        if (index < 0 || index >= count) return;
        setPickError(null);
        setPicked(index);
      });
    }

    return () => {
      seriesRef.current = null;
      chart.remove();
    };
  }, [candles, resolvedTheme, waitingForHolding, useHolding, holdingView, autoscale, canPick]);

  // A new set of bars (another size, other dates) makes an old pick meaningless.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPicked(null), [holdingView]);

  function pick(which: "entry" | "exit") {
    if (!holdingView || picked == null || !onPickCandle) return;
    const bar = holdingView.bars[picked];
    const date = candleMoment(bar, holdingView.interval, holdingView.timeZone, which === "entry" ? debouncedDates.entry : debouncedDates.exit);
    if (!date) {
      setPickError("Switch to 1D or a shorter candle to pick the exact one.");
      return;
    }
    const moment = Date.parse(date);
    const other = tradeMoment(which === "entry" ? debouncedDates.exit : debouncedDates.entry, holdingView.timeZone);
    if (moment > Date.now()) {
      setPickError("That candle is in the future.");
      return;
    }
    // By exchange DAY when the candle is daily or the other date has no time
    // of day: a day trade's entry and exit share a day, and a bare date's
    // stand-in time (noon) must not make the pair look reversed.
    const otherRaw = which === "entry" ? debouncedDates.exit : debouncedDates.entry;
    const otherIsBare = other != null && other !== Date.parse(otherRaw ?? "") / 1000;
    const byDay = isCalendarInterval(holdingView.interval) || otherIsBare;
    const dayOf = (t: number) => Math.floor((t + zoneOffset(holdingView.timeZone, t)) / 86_400);
    const mine = byDay ? dayOf(moment / 1000) : moment / 1000;
    const theirs = other == null ? null : byDay ? dayOf(other) : other;
    if (theirs != null && (which === "entry" ? mine > theirs : mine < theirs)) {
      setPickError(which === "entry" ? "The entry can't be after the exit." : "The exit can't be before the entry.");
      return;
    }
    onPickCandle(which, date);
    setPicked(null);
  }

  // Price lines live in their own effect, keyed only on the three prices.
  // Entry/SL/TP come straight off the trade form, so they change on every
  // keystroke -- having them in the effect above meant each keystroke tore
  // down and re-created the entire chart (createChart + setData for ~130
  // candles). Adding and removing just the price lines on the existing
  // series is comparatively free. Depends on `candles`/`resolvedTheme` only
  // to re-run after the effect above builds a fresh series to draw onto.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const lines: IPriceLine[] = [];
    const specs: { price: number | null; color: string; style: LineStyle; title: string }[] = [
      { price: entryPrice, color: "#3b82f6", style: LineStyle.Solid, title: "Entry" },
      // Drawn in the same blue as Entry (it *is* the entry, adjusted for
      // fees) but dashed, so the pair reads as one idea rather than adding a
      // fifth colour to the chart.
      { price: breakevenPrice, color: "#3b82f6", style: LineStyle.LargeDashed, title: "Breakeven" },
      { price: stopLoss, color: "#ef4444", style: LineStyle.Dashed, title: "Stop Loss" },
      { price: takeProfit, color: "#22c55e", style: LineStyle.Dashed, title: "Take Profit" },
      // Where the trade actually closed, so it reads against Entry and
      // Breakeven directly. The exit marker alone sits on its market bar,
      // which is off-screen whenever the trade doesn't match the market data
      // (the "outside the range" note) -- and then nothing showed the exit at
      // all. Amber: no other line uses it, and it isn't a plan level.
      { price: exitPrice, color: "#f59e0b", style: LineStyle.Solid, title: "Exit" },
      { price: currentPrice, color: "#a1a1aa", style: LineStyle.Dotted, title: "Last" },
    ];
    for (const spec of specs) {
      if (spec.price == null) continue;
      lines.push(
        series.createPriceLine({
          price: spec.price,
          color: spec.color,
          lineWidth: 2,
          lineStyle: spec.style,
          axisLabelVisible: true,
          title: spec.title,
        }),
      );
    }

    // A new provider reference makes the chart recompute its scale around the
    // levels that just changed.
    const provider: AutoscaleInfoProvider = (original) => autoscale(original);
    series.applyOptions({ autoscaleInfoProvider: provider });

    return () => {
      // Guard: if the chart was disposed first, the series is already gone
      // and removing a line off it would throw.
      if (seriesRef.current !== series) return;
      for (const line of lines) series.removePriceLine(line);
    };
  }, [entryPrice, breakevenPrice, stopLoss, takeProfit, exitPrice, currentPrice, candles, resolvedTheme, holdingView, autoscale]);

  function applyOverride() {
    const next = draft.trim().toUpperCase();
    if (!next) return;
    setSymbol(next);
    // Keyed on debouncedTicker, matching the effect above that reads it
    // back. Using the live `ticker` prop here would save the override under
    // a half-typed ticker whenever the user corrects the symbol before the
    // 600ms debounce settles, so the effect would never find it again.
    window.localStorage.setItem(overrideKey(debouncedTicker), next);
  }

  if (!ticker.trim()) return null;

  return (
    <Card standalone={false} hoverable={false} className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3 dark:border-subtle">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
            Chart
          </h2>
          {currentPrice != null && (
            <span className="tnum flex items-center gap-1.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">
              {watchForAutoExecution && (
                <span
                  className="relative flex h-1.5 w-1.5"
                  title="Watching this price for stop-loss / take-profit / entry hits while this page is open"
                >
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
              )}
              ${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}
              {quoteTime && (
                <span className="text-zinc-400" title="When Yahoo last updated this price. Quotes can be delayed.">
                  as of {formatQuoteAge(quoteTime)}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyOverride()}
            placeholder="AAPL, BTC-USD, EURUSD=X"
            className={`${inputClass} w-44`}
          />
          <button
            onClick={applyOverride}
            className="shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-200 hover:border-zinc-500"
          >
            Apply
          </button>
        </div>
      </div>
      {availability && holding.state !== "none" && (
        <div
          role="group"
          aria-label="Timeframe"
          className="flex gap-1.5 overflow-x-auto border-b border-zinc-100 px-5 py-2 dark:border-subtle"
        >
          {availability.map(({ interval, ...a }) => {
            // The size on screen, which is daily after a fallback.
            const active = (holding.state === "ready" ? holding.data.interval : timeframe) === interval;
            const reason = a.ok ? undefined : (a as { reason: string }).reason;
            return (
              <button
                key={interval}
                type="button"
                aria-pressed={active}
                disabled={!a.ok}
                title={reason ?? `${TIMEFRAME_LABELS[interval].long} bars`}
                aria-label={reason ? `${TIMEFRAME_LABELS[interval].long} bars: ${reason}` : `${TIMEFRAME_LABELS[interval].long} bars`}
                onClick={() => setTimeframe(interval)}
                className={`shrink-0 rounded-md border px-2.5 py-1 font-mono text-xs ${
                  active
                    ? "border-primary bg-primary/10 text-zinc-900 dark:text-zinc-50"
                    : "border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-300 dark:disabled:hover:border-zinc-700`}
              >
                {TIMEFRAME_LABELS[interval].short}
              </button>
            );
          })}
        </div>
      )}
      {fallbackNote && (
        <p className="border-b border-zinc-100 px-5 py-2 text-xs text-zinc-500 dark:border-subtle dark:text-zinc-400">{fallbackNote}</p>
      )}
      {holdingView?.mismatch && (
        // The chart is honest about data it can't reconcile: the trade's
        // lines are drawn to their own scale, and this says why the bars
        // aren't beside them.
        <p className="border-b border-amber-500/30 bg-amber-500/10 px-5 py-2.5 text-xs text-amber-800 dark:text-amber-300">
          {holdingView.mismatch.label} {holdingView.mismatch.price.toLocaleString("en-US", { maximumFractionDigits: 8 })} is
          outside {symbol}&apos;s range at that time ({formatQuote(holdingView.mismatch.low)}–
          {formatQuote(holdingView.mismatch.high)},{" "}
          {formatBarTime(holdingView.mismatch.barTime, holdingView.timeZone, holdingView.interval)}). Check the
          symbol, the date or the price. Market data is also adjusted for splits, so a trade from before a split
          won&apos;t line up. The chart is scaled to this trade&apos;s own levels.
          {canPick && " If the date is off, click the candle you actually traded on to correct it."}
        </p>
      )}
      {failed === "unavailable" && !useHolding ? (
        <div className="flex flex-col items-center gap-3 px-5 py-16 text-center text-sm text-zinc-500" role="status">
          <p>Market data is temporarily unavailable. Your trade is fine; only the chart is waiting.</p>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              load(false);
            }}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-200"
          >
            Try again
          </button>
        </div>
      ) : failed && !useHolding ? (
        <p className="px-5 py-16 text-center text-sm text-zinc-500">
          No price history found for &quot;{symbol}&quot;. Try correcting the symbol above.
        </p>
      ) : waitingForHolding || (!useHolding && !candles) ? (
        <p className="flex h-72 items-center justify-center px-5 text-center text-sm text-zinc-500 sm:h-[480px]">
          Loading price history…
        </p>
      ) : (
        // 288px on a phone: 480 was most of the screen. autoSize follows.
        <div className="h-72 w-full overflow-hidden rounded-b-xl sm:h-[480px]" ref={containerRef} />
      )}
      {useHolding && canPick && picked != null && holdingView.bars[picked] && (
        <div
          role="group"
          aria-label="Use this candle"
          data-testid="candle-picker"
          className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-5 py-2.5 text-xs dark:border-subtle"
        >
          <span className="text-zinc-600 dark:text-zinc-300">
            {formatBarTime(holdingView.bars[picked].time, holdingView.timeZone, holdingView.interval)} · O{" "}
            {formatQuote(holdingView.bars[picked].open)} H {formatQuote(holdingView.bars[picked].high)} L{" "}
            {formatQuote(holdingView.bars[picked].low)} C {formatQuote(holdingView.bars[picked].close)}
          </span>
          <button
            type="button"
            onClick={() => pick("entry")}
            className="rounded-full bg-primary px-3 py-1 font-medium text-white hover:brightness-110 dark:text-zinc-950"
          >
            Set as entry candle
          </button>
          {debouncedDates.exit && (
            <button
              type="button"
              onClick={() => pick("exit")}
              className="rounded-full border border-zinc-300 px-3 py-1 font-medium text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-200"
            >
              Set as exit candle
            </button>
          )}
          <button type="button" onClick={() => setPicked(null)} className="text-zinc-500 hover:text-zinc-300">
            Cancel
          </button>
          {pickError && (
            <span role="alert" className="basis-full text-loss">
              {pickError}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
