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
  AlertTriangle,
  CheckCircle2,
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
import { useAutoExecuteTrade } from "@/lib/trades/use-auto-execute";
import { isWatchable } from "@/lib/trades/auto-execute";
import { getMissingFields, type MissingField } from "@/lib/trades/missing-fields";
import { deriveBatchedMoneyFields } from "@/lib/trades/derive-inputs";
import { pendingReason } from "@/lib/trades/pending-reason";
import { nextNumberFieldState } from "@/lib/trades/number-field-input";
import {
  matchCommissionRule,
  computeCommission,
  computeBreakevenPrice,
} from "@/lib/commissions/calculate";
import type { CommissionRule } from "@/lib/commissions/types";
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
  commissionRules = [],
  accountBalance = null,
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
  commissionRules?: CommissionRule[];
  /** Funds the Risk % derivation; null when no deposits are recorded yet. */
  accountBalance?: number | null;
}) {
  const router = useRouter();
  const { trade, status, updateCoreField, updateCustomField, updateStrategyField, flushNow } =
    useAutosaveTrade(initialTrade);
  const [folderIds, setFolderIds] = useState(new Set(initialFolderIds));
  const [strategyIds, setStrategyIds] = useState(new Set(initialStrategyIds));
  const [imageCount, setImageCount] = useState(initialImages.length);
  const [activeExtra, setActiveExtra] = useState<ExtraId | null>(null);
  const [missingOpen, setMissingOpen] = useState(false);
  const hidden = new Set(hiddenCoreFields);
  const isHidden = (field: EditableCoreField) => hidden.has(field);
  const isInvestment = trade.mode === "investment";

  const { handlePriceUpdate, autoExecutionMessage } = useAutoExecuteTrade(
    trade,
    isInvestment,
    updateCoreField,
    flushNow,
  );
  // Only worth polling the live price when there's something for it to
  // trigger. isWatchable is the same function the server cron uses to
  // decide which trades to even fetch a price for -- calling it here
  // directly (rather than re-deriving an equivalent condition) means the
  // UI's "Watching..." indicator can't drift from what actually decides
  // whether to fire, the way it previously did (this used to omit
  // isWatchable's `direction` requirement for an open position, so a
  // trade with a stop but no direction showed the indicator and polled
  // Yahoo every 60s for something that could never actually auto-execute).
  const watchForAutoExecution = isWatchable(trade);

  const missingFields = getMissingFields(trade, isInvestment, hiddenCoreFields);

  // Entry-information fields that feed each other: typing a share count
  // fills in the dollar amount, a stop fills in the risk amount, and so on.
  // Without this every one of them was a box you had to work out yourself,
  // and a blank risk amount is why trades ended up with no R multiple.
  // Hidden fields are still derived -- hiding a field only takes it off the
  // form, and the values behind it still drive P/L and the analytics page.
  //
  // Takes a batch rather than one field so OCR's "apply detected fields"
  // (below) can run the same derivation a normal one-field-at-a-time edit
  // gets -- it previously bypassed this entirely via plain updateCoreField
  // calls, so a screenshot showing Entry/Stop/Shares but no explicit Risk
  // Amount saved with Risk Amount blank and no R Multiple, despite every
  // input needed to compute it having just been detected. Runs derivation
  // once per trigger field in the batch, each seeing the previous ones'
  // results -- the same as if they'd been typed in one at a time -- and
  // never lets a derived value overwrite a field that was *also* explicitly
  // provided in this same batch (e.g. OCR detecting a dollar amount
  // directly shouldn't have entry price x shares silently overwrite it).
  const applyMoneyFieldEdits = (edits: [EditableCoreField, unknown][]) => {
    for (const [key, value] of edits) updateCoreField(key, value);
    const derived = deriveBatchedMoneyFields(
      edits,
      {
        entry_price: trade.entry_price,
        shares: trade.shares,
        dollar_amount: trade.dollar_amount,
        stop_loss: trade.stop_loss,
        risk_amount: trade.risk_amount,
      },
      accountBalance,
    );
    for (const [field, derivedValue] of Object.entries(derived)) {
      updateCoreField(field as EditableCoreField, derivedValue);
    }
  };

  const updateMoneyField = (key: EditableCoreField, value: unknown) => {
    applyMoneyFieldEdits([[key, value]]);
  };

  // Computed client-side (rather than read off the saved row) so the chart's
  // break-even line and the fee readout track what's being typed, instead of
  // lagging a 600ms autosave round trip behind it. The server recomputes and
  // persists the authoritative value on save -- this is purely the live
  // preview of the same calculation.
  const commissionRule = isInvestment ? null : matchCommissionRule(commissionRules, trade);
  const commissionPreview = computeCommission(commissionRule, trade);
  const breakevenPrice = isInvestment ? null : computeBreakevenPrice(commissionRule, trade);

  const pendingInputs = {
    entry_price: trade.entry_price,
    exit_price: trade.exit_price,
    shares: trade.shares,
    stop_loss: trade.stop_loss,
    take_profit: trade.take_profit,
    risk_amount: trade.risk_amount,
    status: trade.status,
    hasCommissionRule: commissionRule != null,
  };

  async function handleDelete() {
    if (!confirm(`Delete trade ${trade.ticker || "(untitled)"}? This cannot be undone.`)) return;
    const res = await fetch(`/api/trades/${trade.id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Couldn't delete this trade. Please try again.");
      return;
    }
    router.push("/trades");
  }

  async function handleDuplicate() {
    const res = await fetch(`/api/trades/${trade.id}/duplicate`, { method: "POST" });
    if (!res.ok) {
      alert("Couldn't duplicate this trade. Please try again.");
      return;
    }
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
      {autoExecutionMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3.5 py-2 text-sm text-primary">
          <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2} />
          {autoExecutionMessage}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SaveStatusBadge status={status} />
        <div className="flex flex-wrap items-center gap-2">
          <MissingFieldsIndicator
            missing={missingFields}
            open={missingOpen}
            onToggle={() => setMissingOpen((o) => !o)}
          />
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
        <div
          data-tour-id="trade-detail-hero"
          className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4"
        >
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
              const edits = Object.entries(fields).filter(([, value]) => value != null) as [
                EditableCoreField,
                unknown,
              ][];
              applyMoneyFieldEdits(edits);
            }}
          />
        </div>

        {!isInvestment && (
          <div className={activeExtra === "results" ? "" : "hidden"}>
            {/* Says out loud that nothing here is typed in. Commission and
                break-even in particular appear on their own the moment a
                commission rule matches, which reads as the app inventing
                numbers if you don't know a rule did it. */}
            <p className="mb-4 text-xs text-zinc-500">
              Worked out from the trade — nothing here is edited directly.
              {commissionRule && !trade.commission_manual && (
                <>
                  {" "}
                  Commission and break-even come from your{" "}
                  <span className="text-zinc-700 dark:text-zinc-300">{commissionRule.name}</span>{" "}
                  rule.
                </>
              )}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ReadOnlyField
              label="Dollar P/L"
              tooltip="Net of commission — this is what actually landed in your account."
              value={trade.dollar_pl}
              pending={pendingReason("dollar_pl", pendingInputs)}
            />
            <ReadOnlyField
              label="Percent Return"
              value={trade.percent_return}
              suffix="%"
              pending={pendingReason("percent_return", pendingInputs)}
            />
            <ReadOnlyField
              label="R Multiple"
              tooltip="Your profit or loss measured against how much you risked. 2.0 means you made twice what you risked; -1.0 means you lost your full risk amount."
              value={trade.r_multiple}
              pending={pendingReason("r_multiple", pendingInputs)}
            />
            <ReadOnlyField
              label="Risk/Reward Ratio"
              tooltip="How much you aimed to gain compared to how much you risked, based on your stop loss and take profit. 3.0 means you were targeting 3x your risk. Based on your price levels only, before commission."
              value={trade.risk_reward_ratio}
              pending={pendingReason("risk_reward_ratio", pendingInputs)}
            />
            <ReadOnlyField
              label="Commission"
              tooltip={
                trade.commission_manual
                  ? "Entered by hand on this trade, so your commission rules won't overwrite it. Clear the Commission field to go back to automatic."
                  : commissionRule
                    ? `Applied automatically from your "${commissionRule.name}" rule. Charged on entry once the trade is open, and again on exit once it's closed.`
                    : "No commission rule matches this trade. Set one up on the Commissions page, or type a value into the Commission field."
              }
              value={trade.commission}
              pending={pendingReason("commission", pendingInputs)}
            />
            <ReadOnlyField
              label="Breakeven Price"
              tooltip={`The price this trade has to reach before it's actually profitable, once the full round trip of commission is paid${commissionPreview.exitFee === 0 && commissionRule ? " (including the exit fee not yet charged)" : ""}. Shown as a dashed line on the chart.`}
              value={breakevenPrice}
              pending={pendingReason("breakeven_price", pendingInputs)}
            />
            </div>
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
        breakevenPrice={breakevenPrice}
        watchForAutoExecution={watchForAutoExecution}
        onPriceUpdate={handlePriceUpdate}
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
                onChange={(v) => updateMoneyField("entry_price", v)}
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
                onChange={(v) => updateMoneyField("stop_loss", v)}
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
                onChange={(v) => updateMoneyField("shares", v)}
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
                onChange={(v) => updateMoneyField("dollar_amount", v)}
              />
            )}
            {!isHidden("risk_amount") && (
              <NumberField
                label="Risk Amount"
                tooltip="The dollar amount you stood to lose if the trade hit your stop loss."
                value={trade.risk_amount}
                onChange={(v) => updateMoneyField("risk_amount", v)}
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
            {!isHidden("commission") && (
              <NumberField
                label="Commission"
                tooltip={
                  trade.commission_manual
                    ? "Set by hand — your commission rules won't change it. Clear this field to go back to calculating it automatically."
                    : commissionRule
                      ? `Filled in automatically from your "${commissionRule.name}" rule. Type over it to set this trade's fee by hand.`
                      : "Broker fees for this trade, subtracted from its P/L. Set up rules on the Commissions page to fill this in automatically."
                }
                value={trade.commission}
                onChange={(v) => updateCoreField("commission", v)}
              />
            )}
          </div>
          {commissionRule && !trade.commission_manual && (
            <p className="mt-3 text-xs text-zinc-500">
              Commission is applied automatically from your{" "}
              <span className="text-zinc-700 dark:text-zinc-300">{commissionRule.name}</span> rule.
              P/L above is net of it.
            </p>
          )}
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
  // `== null`, not `=== null`: a column the database doesn't have yet (a
  // migration applied by hand, so there's always a window) comes back
  // `undefined`.
  const [text, setText] = useState(value == null ? "" : String(value));
  const [lastSeenValue, setLastSeenValue] = useState(value);

  // Adjust state during render (React's documented alternative to an effect
  // for "reset local state when a prop changes") rather than in a
  // useEffect, so the sync happens before the stale text ever paints. Only
  // resets when `value` changed for a reason other than this field's own
  // typing (autosave restore, another field's derived update) -- not when
  // it's just catching up to what was already committed, or an in-progress
  // edit like "5." would get overwritten mid-keystroke.
  if (value !== lastSeenValue) {
    const parsedText = text === "" ? null : Number(text);
    if (value !== parsedText) {
      setText(value == null ? "" : String(value));
    }
    setLastSeenValue(value);
  }

  return (
    <Field label={label} tooltip={tooltip}>
      <input
        type="text"
        inputMode="decimal"
        className={inputClass}
        value={text}
        onChange={(e) => {
          const result = nextNumberFieldState(e.target.value);
          if (!result) return; // reject the keystroke -- e.g. a second "."
          setText(result.text);
          if (result.commit) onChange(result.value);
        }}
      />
    </Field>
  );
}

function ReadOnlyField({
  label,
  value,
  suffix = "",
  tooltip,
  pending,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  tooltip?: string;
  /** Why there's no value yet, shown in place of a bare dash. */
  pending?: string;
}) {
  return (
    <Field label={label} tooltip={tooltip}>
      {/* Worked out by the app, not typed in. It used to borrow inputClass,
          so it was pixel-identical to the editable fields either side of it
          -- people clicked it, nothing happened, and the panel read as
          broken. No border or fill, so it presents as a figure rather than
          as a box waiting for input. */}
      <div className="tnum px-0.5 py-2 font-mono text-sm text-zinc-900 dark:text-zinc-100">
        {/* `== null`, not `=== null`: a column the database doesn't have yet
            reads back `undefined`, and the strict check let that through to
            `undefined.toFixed(2)` -- a TypeError that took down the whole
            trade page, since this panel is always mounted (just hidden). */}
        {value == null ? (
          <span className="font-sans text-xs text-zinc-400 dark:text-zinc-500">
            {pending ?? "—"}
          </span>
        ) : (
          `${value.toFixed(2)}${suffix}`
        )}
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

// Top-right "needs attention" checklist -- always visible (rather than
// disappearing at zero) so it's a reliable landmark to check, not something
// that only shows up once and might be missed.
function MissingFieldsIndicator({
  missing,
  open,
  onToggle,
}: {
  missing: MissingField[];
  open: boolean;
  onToggle: () => void;
}) {
  const complete = missing.length === 0;

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
          complete
            ? open
              ? "border-profit/50 bg-profit/10 text-profit"
              : "border-zinc-200 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-subtle dark:hover:border-zinc-500 dark:hover:text-zinc-300"
            : open
              ? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "border-amber-500/30 text-amber-600 hover:border-amber-500/50 dark:text-amber-400"
        }`}
      >
        {complete ? (
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        {missing.length} to fill
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-subtle dark:bg-card">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
            Still needs
          </p>
          {complete ? (
            <p className="text-sm text-zinc-500">Nothing — this trade is fully filled in.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {missing.map((field) => (
                <li key={field.key} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  {field.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
