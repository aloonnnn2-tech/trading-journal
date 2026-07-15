"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  LineStyle,
  type IChartApi,
} from "lightweight-charts";
import { Card } from "@/components/ui/Card";
import type { Candle } from "@/app/api/market-data/candles/route";

// Skips fetching for asset types Yahoo's plain-ticker endpoint can't
// reliably resolve without a suffix we'd have to guess at (forex needs
// "=X", crypto needs "-USD", etc.) -- mirrors the same check in
// TradingViewChart's guessSymbol rather than risk plotting the wrong
// instrument's price against a real stop/entry/target.
function supportsPlainTicker(assetType: string | null): boolean {
  const type = (assetType ?? "").toLowerCase();
  return !type.includes("crypto") && !type.includes("forex") && !type.includes("fx");
}

export function RiskLevelsChart({
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
  const chartRef = useRef<IChartApi | null>(null);
  const { resolvedTheme } = useTheme();
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [failed, setFailed] = useState(false);

  const clean = ticker.trim().toUpperCase();
  const eligible = clean !== "" && entryPrice != null && supportsPlainTicker(assetType);

  useEffect(() => {
    if (!eligible) {
      // Resets state left over from a previously-eligible ticker so a stale
      // chart can't flash under the new (ineligible) one -- render already
      // bails out via `if (!eligible) return null` below regardless, but
      // this keeps internal state consistent if eligibility flips back.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCandles(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setFailed(false);
    fetch(`/api/market-data/candles?ticker=${encodeURIComponent(clean)}`)
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
  }, [clean, eligible]);

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
    chartRef.current = chart;

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
      chartRef.current = null;
    };
  }, [candles, resolvedTheme, entryPrice, stopLoss, takeProfit]);

  if (!eligible) return null;

  return (
    <Card standalone={false} hoverable={false} className="p-0">
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-subtle">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
          Risk levels
        </h2>
        {candles && <span className="text-[11px] text-zinc-400">Entry · Stop Loss · Take Profit</span>}
      </div>
      {failed ? (
        <p className="px-5 py-6 text-xs text-zinc-500">Price history unavailable for {clean}.</p>
      ) : !candles ? (
        <p className="px-5 py-6 text-xs text-zinc-500">Loading price history…</p>
      ) : (
        <div className="h-[280px] w-full overflow-hidden rounded-b-xl" ref={containerRef} />
      )}
    </Card>
  );
}
