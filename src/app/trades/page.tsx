import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { listFolders } from "@/lib/folders/queries";
import { listFieldDefinitions } from "@/lib/fields/definitions";
import {
  getStatusCounts,
  listDistinctEmotions,
  listDistinctMarkets,
  listTradesPage,
  toTradeSortField,
} from "@/lib/trades/queries";
import { listAllTradeStrategyLinks, listStrategies } from "@/lib/strategies/queries";
import { getAccountBalance } from "@/lib/account/queries";
import type { Trade } from "@/lib/trades/types";
import { AddTradeButton, QuickTradeButton } from "./new-trade-button";
import { ScreenshotTradeButton } from "./screenshot-trade-button";

const PAGE_SIZE = 50;

interface TradesSearchParams {
  folder?: string;
  status?: string;
  q?: string;
  strategy?: string;
  market?: string;
  emotion?: string;
  direction?: string;
  plMin?: string;
  plMax?: string;
  riskMin?: string;
  riskMax?: string;
  fieldKey?: string;
  fieldValue?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<TradesSearchParams>;
}) {
  const params = await searchParams;
  await requireUserId();
  const supabase = await createClient();

  // Validated rather than cast. `status` goes straight into .eq("status", …)
  // against a Postgres enum, so ?status=anything-else came back as a 22P02
  // from the database rather than as an empty list.
  const STATUSES: Trade["status"][] = ["pending", "open", "closed", "expired"];
  const requested = params.status as Trade["status"] | undefined;
  const status = requested && STATUSES.includes(requested) ? requested : undefined;
  const sortBy = toTradeSortField(params.sort);
  const sortDir = (params.dir as "asc" | "desc" | undefined) ?? "desc";
  const page = Math.max(1, Number(params.page) || 1);

  const plMin = params.plMin ? Number(params.plMin) : undefined;
  const plMax = params.plMax ? Number(params.plMax) : undefined;
  // Number("") is 0, which would silently filter to "risk >= 0" -- so an
  // absent or unparseable bound stays undefined rather than becoming a filter.
  const riskMin = Number.isFinite(Number(params.riskMin)) && params.riskMin ? Number(params.riskMin) : undefined;
  const riskMax = Number.isFinite(Number(params.riskMax)) && params.riskMax ? Number(params.riskMax) : undefined;

  const [{ trades, total }, counts, folders, strategies, tradeStrategyLinks, emotions, markets, fieldDefs, account] =
    await Promise.all([
      listTradesPage(supabase, {
        search: params.q,
        status,
        folderId: params.folder,
        strategyId: params.strategy,
        market: params.market,
        emotion: params.emotion,
        direction: params.direction,
        plMin,
        plMax,
        riskMin,
        riskMax,
        customField: params.fieldKey && params.fieldValue ? { key: params.fieldKey, value: params.fieldValue } : undefined,
        sortBy,
        sortDir,
        page,
        pageSize: PAGE_SIZE,
      }),
      getStatusCounts(supabase),
      listFolders(supabase),
      listStrategies(supabase),
      listAllTradeStrategyLinks(supabase),
      listDistinctEmotions(supabase),
      listDistinctMarkets(supabase),
      listFieldDefinitions(supabase, "trade"),
      getAccountBalance(supabase),
    ]);
  const accountBalance = account.hasTransactions ? account.balance : null;

  const strategyNameById = new Map(strategies.map((s) => [s.id, s.name]));
  const stratNamesByTradeId: Record<string, string[]> = {};
  for (const [tradeId, strategyIds] of Object.entries(tradeStrategyLinks)) {
    stratNamesByTradeId[tradeId] = strategyIds
      .map((id) => strategyNameById.get(id))
      .filter((name): name is string => Boolean(name));
  }

  // Only text/dropdown fields support a simple exact-match filter -- other
  // types (number, checkbox, multi_select, etc.) store non-string values
  // and need dedicated controls this filter doesn't attempt to provide.
  const filterableFields = fieldDefs.filter((f) => f.field_type === "text" || f.field_type === "dropdown");

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function buildHref(overrides: Partial<TradesSearchParams>) {
    const next = { ...params, ...overrides };
    const query = new URLSearchParams();
    if (next.folder) query.set("folder", next.folder);
    if (next.status) query.set("status", next.status);
    if (next.q) query.set("q", next.q);
    if (next.strategy) query.set("strategy", next.strategy);
    if (next.market) query.set("market", next.market);
    if (next.emotion) query.set("emotion", next.emotion);
    if (next.plMin) query.set("plMin", next.plMin);
    if (next.plMax) query.set("plMax", next.plMax);
    if (next.fieldKey) query.set("fieldKey", next.fieldKey);
    if (next.fieldValue) query.set("fieldValue", next.fieldValue);
    if (next.sort) query.set("sort", next.sort);
    if (next.dir) query.set("dir", next.dir);
    if (next.page && next.page !== "1") query.set("page", next.page);
    const qs = query.toString();
    return qs ? `/trades?${qs}` : "/trades";
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Trades</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/trades/import"
            className="rounded-full border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:border-zinc-500"
          >
            Import
          </Link>
          <ExportMenu folderId={params.folder} />
          <AddTradeButton />
          <ScreenshotTradeButton accountBalance={accountBalance} />
          <QuickTradeButton accountBalance={accountBalance} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusTab href={buildHref({ status: undefined, page: "1" })} label="All" count={counts.all} active={!status} />
        <StatusTab href={buildHref({ status: "pending", page: "1" })} label="Pending" count={counts.pending} active={status === "pending"} />
        <StatusTab href={buildHref({ status: "open", page: "1" })} label="Open" count={counts.open} active={status === "open"} />
        <StatusTab href={buildHref({ status: "closed", page: "1" })} label="Closed" count={counts.closed} active={status === "closed"} />
        {/* Only once there is one. A tab reading "Expired 0" on every account
            that has never placed a day order is a permanent piece of clutter
            explaining a feature most people will not use. */}
        {counts.expired > 0 && (
          <StatusTab href={buildHref({ status: "expired", page: "1" })} label="Expired" count={counts.expired} active={status === "expired"} />
        )}
      </div>

      {folders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <FolderTab href={buildHref({ folder: undefined, page: "1" })} label="All Folders" active={!params.folder} />
          {folders.map((folder) => (
            <FolderTab
              key={folder.id}
              href={buildHref({ folder: folder.id, page: "1" })}
              label={folder.name}
              active={params.folder === folder.id}
            />
          ))}
        </div>
      )}

      {strategies.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <FolderTab href={buildHref({ strategy: undefined, page: "1" })} label="All Strategies" active={!params.strategy} />
          {strategies.map((strategy) => (
            <FolderTab
              key={strategy.id}
              href={buildHref({ strategy: strategy.id, page: "1" })}
              label={strategy.name}
              active={params.strategy === strategy.id}
            />
          ))}
        </div>
      )}

      {/* The three selects below are populated from the user's own data --
          markets, free-text emotion tags, and custom-field labels. A <select>
          sizes itself to its widest <option>, so a single long value stretched
          the control, the form, and with it the whole page: one 20k-character
          market value produced a 191,000px-wide document against a 914px
          viewport, making the trades list unusable in both directions. The
          field lengths are capped at the API now, but this clamp is what keeps
          any single value -- including rows saved before that cap -- from
          deciding the page width. */}
      <div className="flex flex-wrap items-center gap-3">
        <form action="/trades" method="get" className="flex flex-wrap items-center gap-2">
          {params.folder && <input type="hidden" name="folder" value={params.folder} />}
          {status && <input type="hidden" name="status" value={status} />}
          {params.strategy && <input type="hidden" name="strategy" value={params.strategy} />}
          <input
            id="trade-search"
            data-tour-id="trades-search"
            type="text"
            name="q"
            placeholder="Search ticker or company... (/)"
            defaultValue={params.q ?? ""}
            className="w-56 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary"
          />
          <select
            name="market"
            defaultValue={params.market ?? ""}
            className="max-w-48 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary"
          >
            <option value="">All Markets</option>
            {markets.map((market) => (
              <option key={market} value={market}>
                {market}
              </option>
            ))}
          </select>
          <select
            name="emotion"
            defaultValue={params.emotion ?? ""}
            className="max-w-48 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary"
          >
            <option value="">All Emotions</option>
            {emotions.map((emotion) => (
              <option key={emotion} value={emotion}>
                {emotion}
              </option>
            ))}
          </select>
          <input
            type="number"
            name="plMin"
            placeholder="Min P/L"
            defaultValue={params.plMin ?? ""}
            className="w-24 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary"
          />
          <input
            type="number"
            name="plMax"
            placeholder="Max P/L"
            defaultValue={params.plMax ?? ""}
            className="w-24 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary"
          />
          {filterableFields.length > 0 && (
            <>
              <select
                name="fieldKey"
                defaultValue={params.fieldKey ?? ""}
                className="max-w-48 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary"
              >
                <option value="">Custom Field...</option>
                {filterableFields.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                name="fieldValue"
                placeholder="Value"
                defaultValue={params.fieldValue ?? ""}
                className="w-32 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary"
              />
            </>
          )}
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:border-zinc-500"
          >
            Filter
          </button>
        </form>

        <SortSelect buildHref={buildHref} sortBy={sortBy} sortDir={sortDir} />
      </div>

      <TradeTable trades={trades} stratNamesByTradeId={stratNamesByTradeId} />

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>
          {total === 0 ? "No trades" : `Showing ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div className="flex gap-2">
          <PageLink href={buildHref({ page: String(page - 1) })} disabled={page <= 1}>
            Prev
          </PageLink>
          <span>
            Page {page} of {totalPages}
          </span>
          <PageLink href={buildHref({ page: String(page + 1) })} disabled={page >= totalPages}>
            Next
          </PageLink>
        </div>
      </div>
    </div>
  );
}

function SortSelect({
  buildHref,
  sortBy,
  sortDir,
}: {
  buildHref: (overrides: Partial<TradesSearchParams>) => string;
  sortBy: string;
  sortDir: string;
}) {
  const value = `${sortBy}:${sortDir}`;
  const options: { value: string; label: string }[] = [
    { value: "created_at:desc", label: "Newest first" },
    { value: "created_at:asc", label: "Oldest first" },
    { value: "ticker:asc", label: "Ticker A-Z" },
    { value: "dollar_pl:desc", label: "P/L: High to Low" },
    { value: "dollar_pl:asc", label: "P/L: Low to High" },
    { value: "entry_date:desc", label: "Entry Date: Newest" },
  ];

  return (
    <nav className="flex flex-wrap gap-1 text-sm">
      {options.map((opt) => {
        const [sort, dir] = opt.value.split(":");
        const active = opt.value === value;
        return (
          <Link
            key={opt.value}
            href={buildHref({ sort, dir, page: "1" })}
            className={`rounded-lg px-2 py-1 ${
              active
                ? "bg-primary/10 text-primary"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            {opt.label}
          </Link>
        );
      })}
    </nav>
  );
}

function ExportMenu({ folderId }: { folderId?: string }) {
  const query = folderId ? `&folder=${folderId}` : "";
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-full border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:border-zinc-500">
        Export
      </summary>
      <div className="absolute right-0 z-10 mt-2 flex w-40 flex-col gap-1 rounded-lg border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-2 shadow-lg">
        <a
          href={`/api/trades/export?format=csv${query}`}
          className="rounded px-2 py-1 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          CSV
        </a>
        <a
          href={`/api/trades/export?format=xlsx${query}`}
          className="rounded px-2 py-1 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Excel
        </a>
        <a
          href={`/api/trades/export?format=json${query}`}
          className="rounded px-2 py-1 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          JSON
        </a>
      </div>
    </details>
  );
}

function StatusTab({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-500"
      }`}
    >
      {label} ({count})
    </Link>
  );
}

function FolderTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-sm ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-500"
      }`}
    >
      {label}
    </Link>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="px-2 py-1 text-zinc-400 dark:text-zinc-700">{children}</span>;
  }
  return (
    <Link href={href} className="rounded px-2 py-1 hover:text-zinc-900 dark:hover:text-zinc-100">
      {children}
    </Link>
  );
}

function TradeTable({
  trades,
  stratNamesByTradeId,
}: {
  trades: Trade[];
  stratNamesByTradeId: Record<string, string[]>;
}) {
  if (trades.length === 0) {
    return <p className="py-8 text-center text-sm text-zinc-500">No trades match your filters.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-zinc-200 dark:border-subtle text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-3">Ticker</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Result</th>
            <th className="px-4 py-3">Tags</th>
            <th className="px-4 py-3">Entry Date</th>
            <th className="px-4 py-3">R:R</th>
            <th className="px-4 py-3">Dollar P/L</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.id} className="border-b border-zinc-100 dark:border-zinc-800/60 last:border-0">
              <td className="px-4 py-3">
                <Link
                  href={`/trades/${trade.id}`}
                  className="font-mono font-semibold uppercase text-zinc-900 dark:text-zinc-100 hover:text-primary"
                >
                  {trade.ticker || "Untitled"}
                </Link>
                {trade.mode === "investment" && (
                  <span className="ml-2 text-xs text-zinc-500">(Investment)</span>
                )}
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 capitalize">{trade.status}</td>
              <td className="px-4 py-3">
                <ResultBadge result={trade.result} />
              </td>
              <td className="px-4 py-3">
                <TagChips tags={stratNamesByTradeId[trade.id] ?? []} />
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                {trade.entry_date ? new Date(trade.entry_date).toLocaleDateString() : "—"}
              </td>
              {/* Planned reward against planned risk. Unlike P/L it's known
                  before the trade is over, so it's the one number here that
                  says something about a position still open. */}
              <td className="tnum px-4 py-3 font-mono text-zinc-600 dark:text-zinc-400">
                {trade.risk_reward_ratio != null ? (
                  `${trade.risk_reward_ratio.toFixed(2)}`
                ) : (
                  <span className="font-sans text-zinc-400 dark:text-zinc-600">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                {trade.dollar_pl !== null ? (
                  <span className={trade.dollar_pl >= 0 ? "text-profit" : "text-loss"}>
                    ${trade.dollar_pl.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-zinc-400 dark:text-zinc-600">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="text-zinc-400 dark:text-zinc-600">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-600 dark:text-zinc-300"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function ResultBadge({ result }: { result: Trade["result"] }) {
  const colors: Record<Trade["result"], string> = {
    open: "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200",
    win: "bg-profit/15 text-profit dark:bg-profit/15",
    loss: "bg-loss/15 text-loss dark:bg-loss/15",
    break_even: "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs ${colors[result]}`}>{result}</span>;
}
