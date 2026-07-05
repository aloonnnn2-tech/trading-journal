// Shared confidence indicator for OCR-detected fields. A colored dot plus the
// percentage: green = high, amber = medium (still auto-filled), zinc = low
// (shown as a suggestion, not auto-filled).

export function confidenceTier(c: number): "high" | "medium" | "low" {
  if (c >= 0.85) return "high";
  if (c >= 0.55) return "medium";
  return "low";
}

const DOT: Record<string, string> = {
  high: "bg-green-500",
  medium: "bg-amber-500",
  low: "bg-zinc-400",
};

export function ConfidenceBadge({ confidence, source }: { confidence: number; source?: string }) {
  const tier = confidenceTier(confidence);
  return (
    <span
      className="ml-1 inline-flex items-center gap-1 align-middle text-[10px] font-medium text-zinc-400"
      title={source ? `${source} · ${Math.round(confidence * 100)}% confidence` : `${Math.round(confidence * 100)}% confidence`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[tier]}`} />
      {Math.round(confidence * 100)}%
    </span>
  );
}
