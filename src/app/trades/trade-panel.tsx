"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { formatMoney } from "@/lib/format/money";
import { formatDateTime } from "@/lib/dates/format";
import { formatPrice, formatSigned, holdTime, neighbours, type TradePanelData } from "@/lib/trades/panel";
import { AdherenceBlock } from "@/components/trade-card/plan-adherence-panel";
import { isTypingTarget } from "@/components/keyboard-shortcuts";
import { ResultBadge } from "./result-badge";
import { usePreferences } from "@/components/preferences/preferences-provider";

// The trade side panel (Phase 4A). A read-only summary of one trade: the
// figures, plan adherence from the same helper as the trade page, its
// screenshots and its notes. Editing stays on /trades/<id>, behind "Open full
// page" -- the editable card autosaves as you type, and arrowing away from a
// half-typed edit is a way to lose it.
//
// ← and → step through the list's own order (its filters and sort) and stop
// at the first and last trade on the page. Esc, ✕ and the browser's Back all
// close it. It isn't modal: the list stays usable beside it, and clicking
// another row switches the panel.

type Load =
  | { state: "loading" }
  | { state: "ready"; data: TradePanelData }
  | { state: "missing" }
  | { state: "error" };

async function fetchPanel(id: string): Promise<TradePanelData | "missing"> {
  const res = await fetch(`/api/trades/${id}/panel`, { cache: "no-store" });
  if (res.status === 404) return "missing";
  if (!res.ok) throw new Error(`panel ${res.status}`);
  return (await res.json()) as TradePanelData;
}

export function TradePanel({
  id,
  order,
  onNavigate,
  onClose,
}: {
  id: string;
  /** The list's trade ids, in its current order. */
  order: string[];
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  // ←/→ are keyboard shortcuts, so Settings can turn them off; Esc to
  // close stays -- that is how a dialog is dismissed, not a shortcut.
  const { prefs } = usePreferences();
  const arrowKeys = prefs.keyboardShortcuts;
  // One request per trade per visit to the list, shared by the open and the
  // prefetch, so arrowing onto a prefetched trade is instant.
  const cache = useRef(new Map<string, Promise<TradePanelData | "missing">>());
  const load = useCallback((tradeId: string) => {
    let pending = cache.current.get(tradeId);
    if (!pending) {
      pending = fetchPanel(tradeId);
      // A failure isn't cached, so a retry refetches.
      pending.catch(() => cache.current.delete(tradeId));
      cache.current.set(tradeId, pending);
    }
    return pending;
  }, []);

  const [result, setResult] = useState<{ id: string; load: Load }>({ id, load: { state: "loading" } });
  const [attempt, setAttempt] = useState(0);
  const current: Load = result.id === id ? result.load : { state: "loading" };

  const { prev, next, index } = neighbours(order, id);

  useEffect(() => {
    let cancelled = false;
    load(id)
      .then((data) => {
        if (cancelled) return;
        setResult({ id, load: data === "missing" ? { state: "missing" } : { state: "ready", data } });
      })
      .catch(() => {
        if (!cancelled) setResult({ id, load: { state: "error" } });
      });
    // The trades either side, so the next arrow press has nothing to wait for.
    for (const n of [prev, next]) if (n) load(n).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, prev, next, load, attempt]);

  // Keys. Ignored while typing in a field -- the list's search box is on the
  // same page -- and with modifiers held, which belong to the browser.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (isTypingTarget(e.target) || !arrowKeys) return;
      if (e.key === "ArrowLeft" && prev) {
        e.preventDefault();
        onNavigate(prev);
      } else if (e.key === "ArrowRight" && next) {
        e.preventDefault();
        onNavigate(next);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [prev, next, onNavigate, onClose, arrowKeys]);

  // Focus moves into the panel when it opens, so the keys and a screen reader
  // both start there; the list hands it back to the row on close.
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Starts under the app's sticky top bar rather than over it, so the account
  // menu, help and theme toggle stay reachable while it's open. Measured, not
  // hard-coded: the bar's height isn't a token and changes with its layout.
  const [top, setTop] = useState(0);
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const measure = () => setTop(Math.max(0, Math.round(header.getBoundingClientRect().bottom)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const data = current.state === "ready" ? current.data : null;
  const title = data ? data.trade.ticker || "Untitled" : "Trade";

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={`Trade ${title}`}
      data-trade-panel
      style={{ top }}
      // bottom: the phone tab bar's height (0 elsewhere) -- the panel sits
      // below it in the stack, so its footer would otherwise be hidden.
      className="fixed bottom-[var(--tabbar-h)] right-0 z-30 flex w-full flex-col border-l border-zinc-200 bg-white shadow-[-24px_0_48px_-24px_rgba(0,0,0,0.35)] outline-none dark:border-subtle dark:bg-card sm:w-[560px]"
    >
      {/* Header: where you are, how to move, how to leave. */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-subtle">
        <button
          type="button"
          onClick={() => prev && onNavigate(prev)}
          disabled={!prev}
          aria-label="Previous trade (←)"
          title="Previous trade (←)"
          className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => next && onNavigate(next)}
          disabled={!next}
          aria-label="Next trade (→)"
          title="Next trade (→)"
          className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {index >= 0 && (
          <span className="tnum font-mono text-xs text-zinc-500">
            {index + 1} of {order.length}
          </span>
        )}
        <Link
          href={`/trades/${id}`}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-200"
        >
          Open full page
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close (Esc)"
          title="Close (Esc)"
          className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5" aria-busy={current.state === "loading"}>
        {current.state === "loading" && <PanelSkeleton />}
        {current.state === "missing" && (
          <p className="text-sm text-zinc-500">This trade couldn&apos;t be found. It may have been deleted.</p>
        )}
        {current.state === "error" && (
          <div className="flex flex-col items-start gap-3 text-sm text-zinc-500">
            <p>Couldn&apos;t load this trade.</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-200"
            >
              Try again
            </button>
          </div>
        )}
        {data && <PanelBody data={data} />}
      </div>
    </aside>
  );
}

function PanelBody({ data }: { data: TradePanelData }) {
  const { trade } = data;
  const held = holdTime(trade.entry_date, trade.exit_date);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-2xl font-semibold uppercase text-zinc-900 dark:text-zinc-50">
            {trade.ticker || "Untitled"}
          </h2>
          {trade.direction && (
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${
                trade.direction === "long" ? "border-profit/40 text-profit" : "border-loss/40 text-loss"
              }`}
            >
              {trade.direction}
            </span>
          )}
          <span className="text-xs capitalize text-zinc-500">{trade.status}</span>
          <ResultBadge result={trade.result} status={trade.status} />
        </div>
        {trade.company_name && <p className="mt-1 text-sm text-zinc-500">{trade.company_name}</p>}
      </div>

      {/* The outcome, then the plan, then the timing. "—" for anything not
          recorded or not computable: never a 0 that reads as a result. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Figure label="Net P/L">
          {trade.dollar_pl === null ? (
            "—"
          ) : (
            <span className={trade.dollar_pl >= 0 ? "text-profit" : "text-loss"}>
              {formatMoney(trade.dollar_pl, { sign: "always" })}
            </span>
          )}
        </Figure>
        <Figure label="R multiple">{formatSigned(trade.r_multiple, "R")}</Figure>
        <Figure label="Return">{formatSigned(trade.percent_return, "%")}</Figure>
        <Figure label="Planned R:R">
          {trade.risk_reward_ratio == null ? "—" : trade.risk_reward_ratio.toFixed(2)}
        </Figure>

        <Figure label="Entry">{formatPrice(trade.entry_price)}</Figure>
        <Figure label="Exit">{formatPrice(trade.exit_price)}</Figure>
        <Figure label="Stop">{formatPrice(trade.stop_loss)}</Figure>
        <Figure label="Target">{formatPrice(trade.take_profit)}</Figure>

        <Figure label="Size">
          {trade.shares == null ? "—" : trade.shares.toLocaleString("en-US", { maximumFractionDigits: 8 })}
        </Figure>
        <Figure label="Commission">{formatMoney(trade.commission, { placeholder: "—" })}</Figure>
        <Figure label="Risk">{formatMoney(trade.risk_amount, { placeholder: "—" })}</Figure>
        <Figure label="Held">{held ?? "—"}</Figure>
      </dl>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Entered</dt>
          <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">{formatDateTime(trade.entry_date) || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">Exited</dt>
          <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">{formatDateTime(trade.exit_date) || "—"}</dd>
        </div>
      </dl>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Plan adherence</h3>
        {data.adherences.length === 0 ? (
          <p className="text-sm text-zinc-500">
            {data.hasStrategies
              ? `${data.strategyNames.join(", ") || "This trade's strategy"} has no rules yet.`
              : "Not tagged with a strategy, so there are no rules to check."}
          </p>
        ) : (
          data.adherences.map((adherence) => <AdherenceBlock key={adherence.strategyId} adherence={adherence} />)
        )}
      </section>

      {data.images.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Screenshots</h3>
          <div className="grid grid-cols-2 gap-2">
            {data.images.map((img, i) => (
              <a
                key={img.id}
                href={img.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-lg border border-zinc-200 dark:border-subtle"
              >
                {/* Signed Supabase URLs, one hour: next/image would need the
                    storage host allow-listed and would cache past expiry. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={`Screenshot ${i + 1}`} className="aspect-video w-full object-cover" loading="lazy" />
              </a>
            ))}
          </div>
        </section>
      )}

      {data.textFields.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Notes</h3>
          <dl className="flex flex-col gap-3">
            {data.textFields.map((field) => (
              <div key={field.key}>
                <dt className="text-xs text-zinc-500">{field.label}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200">
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="tnum mt-0.5 truncate font-mono text-sm text-zinc-900 dark:text-zinc-100">{children}</dd>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-hidden>
      <div className="h-7 w-32 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="h-3 w-16 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-4 w-20 rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        ))}
      </div>
      <div className="h-24 rounded bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}
