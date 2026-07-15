"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { createChart, CandlestickSeries, ColorType, LineStyle } from "lightweight-charts";
import { Card } from "@/components/ui/Card";
import type { Candle } from "@/app/api/market-data/candles/route";

const inputClass =
  "rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary font-mono";

function overrideKey(ticker: string) {
  return `price_chart_symbol_override:${ticker.trim().toUpperCase()}`;
}

// Best-effort guess at the symbol Yahoo Finance's chart endpoint expects.
// We don't store the exchange/quote-currency anywhere, so this is a guess
// from asset_type; the user can correct it in the box below and the
// correction is remembered per-ticker in localStorage so it doesn't need
// re-typing next time.
function guessSymbol(ticker: string, assetType: string | null): string {
  const clean = ticker.trim().toUpperCase().replace(/[\s/\\-]/g, "");
  if (!clean) return "";
  const type = (assetType ?? "").toLowerCase();
  if (type.includes("crypto")) {
    const base = clean.replace(/USDT?$/, "") || clean;
    return `${base}-USD`;
  }
  if (type.includes("forex") || type.includes("fx")) {
    return `${clean}=X`;
  }
  return clean;
}

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
}: {
  ticker: string;
  assetType: string | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [symbol, setSymbol] = useState("");
  const [draft, setDraft] = useState("");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [failed, setFailed] = useState(false);

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

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    // Clears the previous symbol's candles before fetching the new one, so
    // a stale chart can't flash under a changed ticker/override.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCandles(null);
    setFailed(false);
    fetch(`/api/market-data/candles?ticker=${encodeURIComponent(symbol)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: { candles: Candle[] }) => {
        if (!cancelled) setCandles(data.candles);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

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

    if (entryPrice != null) {
      series.createPriceLine({
        price: entryPrice,
        color: "#3b82f6",
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: "Entry",
      });
    }
    if (stopLoss != null) {
      series.createPriceLine({
        price: stopLoss,
        color: "#ef4444",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Stop Loss",
      });
    }
    if (takeProfit != null) {
      series.createPriceLine({
        price: takeProfit,
        color: "#22c55e",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Take Profit",
      });
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [candles, resolvedTheme, entryPrice, stopLoss, takeProfit]);

  function applyOverride() {
    const next = draft.trim().toUpperCase();
    if (!next) return;
    setSymbol(next);
    window.localStorage.setItem(overrideKey(ticker), next);
  }

  if (!ticker.trim()) return null;

  return (
    <Card standalone={false} hoverable={false} className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3 dark:border-subtle">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
          Chart
        </h2>
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
