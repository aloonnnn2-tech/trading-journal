"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  LineStyle,
  type IPriceLine,
  type ISeriesApi,
} from "lightweight-charts";
import { Card } from "@/components/ui/Card";
import type { Candle, CandlesResponse } from "@/app/api/market-data/candles/route";
import { guessYahooSymbol } from "@/lib/market-data/yahoo";

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
export function PriceChart({
  ticker,
  assetType,
  entryPrice,
  stopLoss,
  takeProfit,
  breakevenPrice = null,
  watchForAutoExecution = false,
  onPriceUpdate,
}: {
  ticker: string;
  assetType: string | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
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
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const { resolvedTheme } = useTheme();
  const [symbol, setSymbol] = useState("");
  const [draft, setDraft] = useState("");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  // Kept current via an effect (not read directly) so the polling effect
  // below doesn't need `onPriceUpdate` itself in its dependency array --
  // that prop is a fresh arrow function on every TradeCard render, which
  // would otherwise tear down and restart the poll interval constantly.
  const onPriceUpdateRef = useRef(onPriceUpdate);
  useEffect(() => {
    onPriceUpdateRef.current = onPriceUpdate;
  }, [onPriceUpdate]);

  // Ticker/asset type update on every keystroke while editing the trade
  // form, but re-fetching candles and rebuilding the chart is expensive.
  // Debounce so it only happens after typing pauses, matching the app's
  // existing 600ms autosave cadence.
  const [debouncedTicker, setDebouncedTicker] = useState(ticker);
  const [debouncedAssetType, setDebouncedAssetType] = useState(assetType);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTicker(ticker);
      setDebouncedAssetType(assetType);
    }, 600);
    return () => clearTimeout(timer);
  }, [ticker, assetType]);

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
            if (latest && seriesRef.current) {
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
          setFailed(false);
          onPriceUpdateRef.current?.({
            currentPrice: data.currentPrice,
            dayHigh: data.dayHigh,
            dayLow: data.dayLow,
            quoteTime: data.quoteTime ? new Date(data.quoteTime) : null,
          });
        })
        .catch(() => {
          // A failed poll leaves the last-known price/chart on screen
          // rather than blanking a working chart over a transient hiccup;
          // only a fresh symbol's failed initial load surfaces "not found".
          if (activeSymbolRef.current === symbol && !isPoll) setFailed(true);
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
    setFailed(false);
    load(false);
  }, [symbol, load]);

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
    const interval = setInterval(() => load(true), WATCH_POLL_MS);
    return () => clearInterval(interval);
  }, [symbol, watchForAutoExecution, load]);

  useEffect(() => {
    if (!containerRef.current || !candles || candles.length === 0) return;
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
      timeScale: { borderVisible: false },
      rightPriceScale: { borderVisible: false },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    series.setData(candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
    seriesRef.current = series;

    chart.timeScale().fitContent();

    return () => {
      seriesRef.current = null;
      chart.remove();
    };
  }, [candles, resolvedTheme]);

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

    return () => {
      // Guard: if the chart was disposed first, the series is already gone
      // and removing a line off it would throw.
      if (seriesRef.current !== series) return;
      for (const line of lines) series.removePriceLine(line);
    };
  }, [entryPrice, breakevenPrice, stopLoss, takeProfit, currentPrice, candles, resolvedTheme]);

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
      {failed ? (
        <p className="px-5 py-16 text-center text-sm text-zinc-500">
          No price history found for &quot;{symbol}&quot; — try correcting the symbol above.
        </p>
      ) : !candles ? (
        <p className="px-5 py-16 text-center text-sm text-zinc-500">Loading price history…</p>
      ) : (
        <div className="h-[480px] w-full overflow-hidden rounded-b-xl" ref={containerRef} />
      )}
    </Card>
  );
}
