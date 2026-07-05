import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { InfoTip } from "@/components/ui/InfoTip";

export type StatTone = "positive" | "negative" | "neutral";

// Stat tile: muted small-caps label, large ink value, optional tinted icon
// chip, tone tick, and meter. The value stays in ink except for P/L-style
// stats, where green/red is the domain convention traders scan for.
export function StatCard({
  label,
  value,
  tone = "neutral",
  colorValue = false,
  tooltip,
  hint,
  meter,
  icon: Icon,
  iconClass = "bg-primary/10 text-primary",
}: {
  label: string;
  value: string;
  tone?: StatTone;
  /** Color the value itself by tone (reserved for P/L-style stats). */
  colorValue?: boolean;
  tooltip?: string;
  /** Small secondary line under the value. */
  hint?: string;
  /** 0..1 — renders a thin meter bar under the value (e.g. win rate). */
  meter?: number;
  /** Optional icon rendered in a tinted chip on the right. */
  icon?: LucideIcon;
  /** Tint classes for the icon chip, e.g. "bg-amber-500/10 text-amber-500". */
  iconClass?: string;
}) {
  const valueColor =
    colorValue && tone === "positive"
      ? "text-profit"
      : colorValue && tone === "negative"
        ? "text-loss"
        : "text-zinc-900 dark:text-zinc-50";

  return (
    <Card className="p-4" standalone={false} hoverable={false}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
            {label}
            {tooltip && <InfoTip text={tooltip} />}
          </p>
          <p
            className={`mt-1.5 flex items-baseline gap-1.5 text-[22px] font-semibold leading-tight tracking-tight ${valueColor}`}
          >
            {!colorValue && tone !== "neutral" && (
              <span className={`text-sm ${tone === "positive" ? "text-profit" : "text-loss"}`}>
                {tone === "positive" ? "▲" : "▼"}
              </span>
            )}
            {value}
          </p>
          {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
        </div>
        {Icon && (
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
            <Icon className="h-4 w-4" strokeWidth={2} />
          </span>
        )}
      </div>
      {meter !== undefined && (
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
            style={{ width: `${Math.max(0, Math.min(1, meter)) * 100}%` }}
          />
        </div>
      )}
    </Card>
  );
}
