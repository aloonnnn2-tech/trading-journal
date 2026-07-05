"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Card } from "@/components/ui/Card";

const inputClass =
  "rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary font-mono";

function overrideKey(ticker: string) {
  return `tv_symbol_override:${ticker.trim().toUpperCase()}`;
}

// TradingView's embed widget needs an exchange-qualified symbol. We don't
// store the exchange anywhere, so this is a best-effort guess from
// asset_type; the user can correct it and we remember the correction
// per-ticker in localStorage so it doesn't need re-typing next time.
function guessSymbol(ticker: string, assetType: string | null): string {
  const clean = ticker.trim().toUpperCase().replace(/[\s/\\-]/g, "");
  if (!clean) return "";
  const type = (assetType ?? "").toLowerCase();
  if (type.includes("crypto")) {
    return /USDT?$/.test(clean) ? `BINANCE:${clean}` : `BINANCE:${clean}USDT`;
  }
  if (type.includes("forex") || type.includes("fx")) {
    return `FX:${clean}`;
  }
  return clean;
}

export function TradingViewChart({
  ticker,
  assetType,
}: {
  ticker: string;
  assetType: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [symbol, setSymbol] = useState("");
  const [draft, setDraft] = useState("");

  // Ticker/asset type update on every keystroke while editing the trade
  // form, but rebuilding the embedded chart is expensive (full iframe
  // teardown + reload). Debounce so it only rebuilds after typing pauses,
  // matching the app's existing 600ms autosave cadence.
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
    if (!symbol || !containerRef.current) return;
    const dark = resolvedTheme !== "light";
    containerRef.current.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: "D",
      timezone: "Etc/UTC",
      theme: dark ? "dark" : "light",
      style: "1",
      locale: "en",
      backgroundColor: dark ? "rgba(26, 26, 25, 1)" : "rgba(253, 253, 252, 1)",
      gridColor: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(28, 27, 24, 0.06)",
      allow_symbol_change: true,
      support_host: "https://www.tradingview.com",
    });
    containerRef.current.appendChild(script);
  }, [symbol, resolvedTheme]);

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
          Live chart
        </h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyOverride()}
            placeholder="NASDAQ:AAPL"
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
      <div className="h-[480px] w-full overflow-hidden rounded-b-xl">
        <div className="h-full w-full" ref={containerRef} />
      </div>
    </Card>
  );
}
