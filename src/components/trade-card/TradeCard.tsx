"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Info,
  CalendarDays,
  FolderOpen,
  ImagePlus,
  Calculator,
  NotebookPen,
  Target,
  type LucideIcon,
} from "lucide-react";
import { FieldInput } from "@/components/field-input";
import { Card } from "@/components/ui/Card";
import { InfoTip } from "@/components/ui/InfoTip";
import { ImageUploader } from "@/components/trade-card/ImageUploader";
import { PriceChart } from "@/components/trade-card/PriceChart";
import type { FieldDefinition } from "@/lib/fields/types";
import type { Folder } from "@/lib/folders/types";
import type { Strategy } from "@/lib/strategies/types";
import { useAutosaveTrade } from "@/lib/trades/use-autosave-trade";
import type { EditableCoreField, Trade } from "@/lib/trades/types";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";
const labelClass = "mb-1 block text-xs font-medium text-zinc-500";

type ExtraId = "details" | "dates" | "folders" | "strategies" | "images" | "results" | "notes";

interface TradeImageItem {
  id: string;
  signedUrl: string;
  storagePath: string;
}

export function TradeCard({
  trade: initialTrade,
  fieldDefinitions,
  hiddenCoreFields = [],
  folders = [],
  initialFolderIds = [],
  initialImages = [],
  strategies = [],
  initialStrategyIds = [],
  strategyFieldDefinitions = {},
}: {
  trade: Trade;
  fieldDefinitions: FieldDefinition[];
  hiddenCoreFields?: EditableCoreField[];
  folders?: Folder[];
  initialFolderIds?: string[];
  initialImages?: TradeImageItem[];
  strategies?: Strategy[];
  initialStrategyIds?: string[];
  strategyFieldDefinitions?: Record<string, FieldDefinition[]>;
}) {
  const router = useRouter();
  const { trade, status, updateCoreField, updateCustomField, updateStrategyField, flushNow } =
    useAutosaveTrade(initialTrade);
  const [folderIds, setFolderIds] = useState(new Set(initialFolderIds));
  const [strategyIds, setStrategyIds] = useState(new Set(initialStrategyIds));
  const [imageCount, setImageCount] = useState(initialImages.length);
  const [activeExtra, setActiveExtra] = useState<ExtraId | null>(null);
  const hidden = new Set(hiddenCoreFields);
  const isHidden = (field: EditableCoreField) => hidden.has(field);
  const isInvestment = trade.mode === "investment";

  async function handleDelete() {
    if (!confirm(`Delete trade ${trade.ticker || "(untitled)"}? This cannot be undone.`)) return;
    await fetch(`/api/trades/${trade.id}`, { method: "DELETE" });
    router.push("/trades");
  }

  async function handleDuplicate() {
    const res = await fetch(`/api/trades/${trade.id}/duplicate`, { method: "POST" });
    const duplicate = (await res.json()) as Trade;
    router.push(`/trades/${duplicate.id}`);
  }

  // Mode switches which set of field_definitions the server fetches
  // (trade vs. investment), so it bypasses the autosave debounce and
  // refreshes the page immediately to pick up the new field set.
  // Mode change is special: updateCoreField updates local state instantly
  // (so the layout switches right away) but normally autosaves on a
  // debounce. Mode needs the save to land before refresh() re-fetches
  // field_definitions for the new entity_type, so it's flushed immediately.
  async function handleModeChange(mode: "trade" | "investment") {
    updateCoreField("mode", mode);
    await flushNow();
    router.refresh();
  }

  async function toggleFolder(folderId: string) {
    const previous = folderIds;
    const next = new Set(folderIds);
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    setFolderIds(next);

    const res = await fetch(`/api/trades/${trade.id}/folders`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderIds: Array.from(next) }),
    });
    if (!res.ok) setFolderIds(previous);
  }

  async function toggleStrategy(strategyId: string) {
    const previous = strategyIds;
    const next = new Set(strategyIds);
    if (next.has(strategyId)) next.delete(strategyId);
    else next.add(strategyId);
    setStrategyIds(next);

    const res = await fetch(`/api/trades/${trade.id}/strategies`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategyIds: Array.from(next) }),
    });
    if (!res.ok) setStrategyIds(previous);
  }

  const showDates = !isHidden("entry_date") || !isHidden("exit_date");
  const extras: { id: ExtraId; label: string; icon: LucideIcon; count?: number; show: boolean }[] = [
    { id: "details", label: "Details", icon: Info, show: true },
    { id: "dates", label: "Dates", icon: CalendarDays, show: showDates },
    { id: "folders", label: "Folders", icon: FolderOpen, count: folderIds.size, show: folders.length > 0 },
    { id: "strategies", label: "Strategies", icon: Target, count: strategyIds.size, show: strategies.length > 0 },
    { id: "images", label: "Images", icon: ImagePlus, count: imageCount, show: true },
    { id: "results", label: "Auto-calc", icon: Calculator, show: !isInvestment },
    {
      id: "notes",
      label: isInvestment ? "Investment details" : "Notes & fields",
      icon: NotebookPen,
      show: fieldDefinitions.length > 0,
    },
  ];

  const pl = trade.dollar_pl;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <SaveStatusBadge status={status} />
        <div className="flex gap-2">
          <a
            href={`/api/trades/${trade.id}/export?format=json`}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3.5 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:border-zinc-500"
          >
            Export
          </a>
          <button
            onClick={handleDuplicate}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3.5 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:border-zinc-500"
          >
            Duplicate
          </button>
          <button
            onClick={handleDelete}
            className="rounded-lg border border-loss/40 px-3.5 py-1.5 text-sm text-loss hover:border-loss"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Hero: the fields you touch on every trade, plus live P/L. */}
      <Card standalone={false} hoverable={false}>
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Ticker">
              <input
                type="text"
                className={`${inputClass} font-mono text-base font-semibold uppercase tracking-tight`}
                value={trade.ticker}
                placeholder="AAPL"
                onChange={(e) => updateCoreField("ticker", e.target.value)}
              />
            </Field>
            {!isInvestment && !isHidden("direction") && (
              <Field label="Direction">
                <select
                  className={inputClass}
                  value={trade.direction ?? ""}
                  onChange={(e) => updateCoreField("direction", e.target.value || null)}
                >
                  <option value="">—</option>
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </Field>
            )}
            <Field label="Status">
              <select
                className={inputClass}
                value={trade.status}
                onChange={(e) => updateCoreField("status", e.target.value)}
              >
                <option value="pending">Pending Order</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </Field>
            {!isInvestment && (
              <Field label="Result">
                <select
                  className={inputClass}
                  value={trade.result}
                  onChange={(e) => updateCoreField("result", e.target.value)}
                >
                  <option value="open">Open</option>
                  <option value="win">Win</option>
                  <option value="loss">Loss</option>
                  <option value="break_even">Break Even</option>
                </select>
              </Field>
            )}
          </div>
          {!isInvestment && (
            <div className="shrink-0 text-right">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
                Dollar P/L
              </p>
              <p
                className={`tnum mt-1 font-mono text-2xl font-semibold tracking-tight ${
                  pl === null
                    ? "text-zinc-400 dark:text-zinc-600"
                    : pl >= 0
                      ? "text-profit"
                      : "text-loss"
                }`}
              >
                {pl === null ? "—" : `${pl < 0 ? "−" : "+"}$${Math.abs(pl).toFixed(2)}`}
              </p>
              <p className="tnum mt-0.5 font-mono text-xs text-zinc-500">
                {trade.r_multiple !== null ? `${trade.r_multiple.toFixed(2)}R` : "—"}
                {trade.percent_return !== null ? ` · ${trade.percent_return.toFixed(2)}%` : ""}
              </p>
            </div>
          )}
        </div>

        {/* Everything secondary lives behind these chips. */}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-zinc-100 pt-4 dark:border-subtle">
          {extras
            .filter((e) => e.show)
            .map((extra) => {
              const active = activeExtra === extra.id;
              return (
                <button
                  key={extra.id}
                  onClick={() => setActiveExtra(active ? null : extra.id)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-zinc-200 text-zinc-500 hover:border-zinc-400 hover:text-zinc-800 dark:border-subtle dark:hover:border-zinc-500 dark:hover:text-zinc-200"
                  }`}
                >
                  <extra.icon className="h-3.5 w-3.5" strokeWidth={2} />
                  {extra.label}
                  {extra.count !== undefined && extra.count > 0 && (
                    <span
                      className={`tnum rounded-full px-1.5 font-mono text-[10px] ${
                        active ? "bg-primary/15" : "bg-zinc-100 dark:bg-zinc-800"
                      }`}
                    >
                      {extra.count}
                    </span>
                  )}
                </button>
              );
            })}
        </div>
      </Card>

      {/* Expandable extra panels — kept mounted so uploader/input state
          survives collapsing; only visibility toggles. */}
      <Card
        standalone={false}
        hoverable={false}
        className={activeExtra === null ? "hidden" : "border-primary/30"}
      >
        <div className={activeExtra === "details" ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-4" : "hidden"}>
          <Field label="Mode">
            <select
              className={inputClass}
              value={trade.mode}
              onChange={(e) => handleModeChange(e.target.value as "trade" | "investment")}
            >
              <option value="trade">Trade</option>
              <option value="investment">Investment</option>
            </select>
          </Field>
          {!isHidden("company_name") && (
            <Field label="Company Name">
              <input
                type="text"
                className={inputClass}
                value={trade.company_name ?? ""}
                onChange={(e) => updateCoreField("company_name", e.target.value)}
              />
            </Field>
          )}
          {!isHidden("asset_type") && (
            <Field label="Asset Type">
              <input
                type="text"
                className={inputClass}
                value={trade.asset_type ?? ""}
                onChange={(e) => updateCoreField("asset_type", e.target.value)}
              />
            </Field>
          )}
          {!isHidden("market") && (
            <Field label="Market">
              <input
                type="text"
                className={inputClass}
                value={trade.market ?? ""}
                onChange={(e) => updateCoreField("market", e.target.value)}
              />
            </Field>
          )}
        </div>

        <div className={activeExtra === "dates" ? "grid gap-4 sm:grid-cols-2" : "hidden"}>
          {!isHidden("entry_date") && (
            <Field label="Entry Date">
              <input
                type="date"
                className={inputClass}
                value={trade.entry_date?.slice(0, 10) ?? ""}
                onChange={(e) => updateCoreField("entry_date", e.target.value || null)}
              />
            </Field>
          )}
          {!isHidden("exit_date") && (
            <Field label="Exit Date">
              <input
                type="date"
                className={inputClass}
                value={trade.exit_date?.slice(0, 10) ?? ""}
                onChange={(e) => updateCoreField("exit_date", e.target.value || null)}
              />
            </Field>
          )}
        </div>

        {folders.length > 0 && (
          <div className={activeExtra === "folders" ? "grid gap-2 sm:grid-cols-2" : "hidden"}>
            {folders.map((folder) => (
              <label key={folder.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={folderIds.has(folder.id)}
                  onChange={() => toggleFolder(folder.id)}
                  className="h-4 w-4 accent-[--color-primary]"
                />
                <span className="text-zinc-900 dark:text-zinc-100">{folder.name}</span>
              </label>
            ))}
          </div>
        )}

        {strategies.length > 0 && (
          <div className={activeExtra === "strategies" ? "flex flex-col gap-5" : "hidden"}>
            <div className="grid gap-2 sm:grid-cols-2">
              {strategies.map((strategy) => (
                <label key={strategy.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={strategyIds.has(strategy.id)}
                    onChange={() => toggleStrategy(strategy.id)}
                    className="h-4 w-4 accent-[--color-primary]"
                  />
                  <span className="text-zinc-900 dark:text-zinc-100">{strategy.name}</span>
                </label>
              ))}
            </div>

            {strategies
              .filter((s) => strategyIds.has(s.id) && (strategyFieldDefinitions[s.id]?.length ?? 0) > 0)
              .map((strategy) => (
                <div key={strategy.id} className="flex flex-col gap-3 border-t border-zinc-100 pt-4 dark:border-subtle">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
                    {strategy.name} fields
                  </h3>
                  {strategyFieldDefinitions[strategy.id].map((field) => (
                    <div key={field.id}>
                      <label className={labelClass}>{field.label}</label>
                      <FieldInput
                        field={field}
                        value={trade.strategy_field_values[strategy.id]?.[field.key] as never}
                        onChange={(value) => updateStrategyField(strategy.id, field.key, value)}
                      />
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}

        <div className={activeExtra === "images" ? "" : "hidden"}>
          <ImageUploader
            tradeId={trade.id}
            initialImages={initialImages}
            onCountChange={setImageCount}
            onApplyFields={(fields) => {
              for (const [key, value] of Object.entries(fields)) {
                if (value != null) updateCoreField(key as EditableCoreField, value);
              }
            }}
          />
        </div>

        {!isInvestment && (
          <div className={activeExtra === "results" ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-4" : "hidden"}>
            <ReadOnlyField label="Dollar P/L" value={trade.dollar_pl} />
            <ReadOnlyField label="Percent Return" value={trade.percent_return} suffix="%" />
            <ReadOnlyField
              label="R Multiple"
              tooltip="Your profit or loss measured against how much you risked. 2.0 means you made twice what you risked; -1.0 means you lost your full risk amount."
              value={trade.r_multiple}
            />
            <ReadOnlyField
              label="Risk/Reward Ratio"
              tooltip="How much you aimed to gain compared to how much you risked, based on your stop loss and take profit. 3.0 means you were targeting 3x your risk."
              value={trade.risk_reward_ratio}
            />
          </div>
        )}

        {fieldDefinitions.length > 0 && (
          <div className={activeExtra === "notes" ? "grid gap-4" : "hidden"}>
            {fieldDefinitions.map((field) => (
              <div key={field.id}>
                <label className={labelClass}>{field.label}</label>
                <FieldInput
                  field={field}
                  value={trade.custom_fields[field.key] as never}
                  onChange={(value) => updateCustomField(field.key, value)}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      <PriceChart
        ticker={trade.ticker}
        assetType={trade.asset_type}
        entryPrice={isInvestment ? null : trade.entry_price}
        stopLoss={isInvestment ? null : trade.stop_loss}
        takeProfit={isInvestment ? null : trade.take_profit}
      />

      {!isInvestment && (
        <Card standalone={false} hoverable={false}>
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
            Entry information
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {!isHidden("entry_price") && (
              <NumberField
                label="Entry Price"
                value={trade.entry_price}
                onChange={(v) => updateCoreField("entry_price", v)}
              />
            )}
            {!isHidden("exit_price") && (
              <NumberField
                label="Exit Price"
                value={trade.exit_price}
                onChange={(v) => updateCoreField("exit_price", v)}
              />
            )}
            {!isHidden("stop_loss") && (
              <NumberField
                label="Stop Loss"
                value={trade.stop_loss}
                onChange={(v) => updateCoreField("stop_loss", v)}
              />
            )}
            {!isHidden("take_profit") && (
              <NumberField
                label="Take Profit"
                value={trade.take_profit}
                onChange={(v) => updateCoreField("take_profit", v)}
              />
            )}
            {!isHidden("shares") && (
              <NumberField
                label="Number of Shares"
                value={trade.shares}
                onChange={(v) => updateCoreField("shares", v)}
              />
            )}
            {!isHidden("position_size") && (
              <NumberField
                label="Position Size"
                value={trade.position_size}
                onChange={(v) => updateCoreField("position_size", v)}
              />
            )}
            {!isHidden("dollar_amount") && (
              <NumberField
                label="Dollar Amount"
                value={trade.dollar_amount}
                onChange={(v) => updateCoreField("dollar_amount", v)}
              />
            )}
            {!isHidden("risk_amount") && (
              <NumberField
                label="Risk Amount"
                tooltip="The dollar amount you stood to lose if the trade hit your stop loss."
                value={trade.risk_amount}
                onChange={(v) => updateCoreField("risk_amount", v)}
              />
            )}
            {!isHidden("risk_percent") && (
              <NumberField
                label="Risk %"
                tooltip="The risk amount as a percentage of your total account."
                value={trade.risk_percent}
                onChange={(v) => updateCoreField("risk_percent", v)}
              />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  tooltip,
}: {
  label: string;
  children: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <div>
      <label className={`${labelClass} flex items-center gap-1.5`}>
        {label}
        {tooltip && <InfoTip text={tooltip} />}
      </label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  tooltip,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  tooltip?: string;
}) {
  return (
    <Field label={label} tooltip={tooltip}>
      <input
        type="number"
        step="any"
        className={inputClass}
        value={value === null ? "" : value}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    </Field>
  );
}

function ReadOnlyField({
  label,
  value,
  suffix = "",
  tooltip,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  tooltip?: string;
}) {
  return (
    <Field label={label} tooltip={tooltip}>
      <div className={`${inputClass} tnum font-mono text-zinc-500`}>
        {value === null ? "—" : `${value.toFixed(2)}${suffix}`}
      </div>
    </Field>
  );
}

function SaveStatusBadge({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  const text = {
    idle: "Autosave on",
    saving: "Saving...",
    saved: "Saved",
    error: "Save failed",
  }[status];

  const color = {
    idle: "text-zinc-500",
    saving: "text-amber-500",
    saved: "text-profit",
    error: "text-loss",
  }[status];

  return (
    <span className={`flex items-center gap-1.5 text-xs ${color}`}>
      <span className="relative flex h-1.5 w-1.5">
        {status === "saving" && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
        )}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      {text}
    </span>
  );
}
