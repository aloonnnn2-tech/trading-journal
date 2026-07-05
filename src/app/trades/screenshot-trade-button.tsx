"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ALLOWED_IMAGE_TYPES } from "@/lib/images/queries";
import type { OcrCoreField, ParseResult } from "@/lib/ocr/types";
import { AUTOFILL_CONFIDENCE } from "@/lib/ocr/types";
import { ConfidenceBadge } from "@/components/ocr/ConfidenceBadge";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";
const labelClass = "mb-1 flex items-center text-xs font-medium text-zinc-500";

type Step = "pick" | "scanning" | "review";
type FieldType = "text" | "number" | "date" | "direction" | "status";

interface FieldDef {
  key: OcrCoreField;
  label: string;
  type: FieldType;
}

const PRIMARY: FieldDef[] = [
  { key: "ticker", label: "Ticker", type: "text" },
  { key: "direction", label: "Direction", type: "direction" },
  { key: "entry_price", label: "Entry Price", type: "number" },
  { key: "exit_price", label: "Exit Price", type: "number" },
  { key: "stop_loss", label: "Stop Loss", type: "number" },
  { key: "take_profit", label: "Take Profit", type: "number" },
  { key: "shares", label: "Number of Shares", type: "number" },
  { key: "status", label: "Status", type: "status" },
];

const MORE: FieldDef[] = [
  { key: "company_name", label: "Company Name", type: "text" },
  { key: "asset_type", label: "Asset Type", type: "text" },
  { key: "market", label: "Market", type: "text" },
  { key: "position_size", label: "Position Size", type: "number" },
  { key: "dollar_amount", label: "Dollar Amount", type: "number" },
  { key: "risk_amount", label: "Risk Amount", type: "number" },
  { key: "risk_percent", label: "Risk %", type: "number" },
  { key: "entry_date", label: "Entry Date", type: "date" },
  { key: "exit_date", label: "Exit Date", type: "date" },
];

const NUMERIC_KEYS = new Set<OcrCoreField>([
  "entry_price",
  "exit_price",
  "stop_loss",
  "take_profit",
  "shares",
  "position_size",
  "dollar_amount",
  "risk_amount",
  "risk_percent",
]);
const DATE_KEYS = new Set<OcrCoreField>(["entry_date", "exit_date"]);

function toInput(key: OcrCoreField, value: unknown): string {
  if (value == null) return "";
  if (DATE_KEYS.has(key)) return String(value).slice(0, 10);
  return String(value);
}

export function ScreenshotTradeButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("pick");
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setResult(null);
    setValues({});
    setError(null);
    setShowRaw(false);
    setShowMore(false);
    setShowExample(false);
    setCopied(false);
  }

  function close() {
    if (submitting || step === "scanning") return;
    setOpen(false);
    reset();
  }

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function applyDetected(parsed: ParseResult) {
    const next: Record<string, string> = { direction: "long", status: "open" };
    for (const key of [...PRIMARY, ...MORE].map((f) => f.key)) {
      const f = parsed.core[key];
      if (f && f.confidence >= AUTOFILL_CONFIDENCE) next[key] = toInput(key, f.value);
    }
    // A detected exit price means the trade is already closed — but only act
    // on it if it's confident enough to have actually been filled in above;
    // otherwise Status would flip to Closed while Exit Price stays blank.
    if (!parsed.core.status && parsed.core.exit_price && parsed.core.exit_price.confidence >= AUTOFILL_CONFIDENCE) {
      next.status = "closed";
    }
    setValues(next);
  }

  async function handleFile(selected: File) {
    setError(null);
    if (!ALLOWED_IMAGE_TYPES.has(selected.type)) {
      setError("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
      return;
    }
    if (selected.size > 5 * 1024 * 1024) {
      setError("File exceeds 5 MB limit.");
      return;
    }

    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    setStep("scanning");

    try {
      const formData = new FormData();
      formData.append("file", selected);
      const res = await fetch("/api/ocr/parse", { method: "POST", body: formData });
      const parsed = (await res.json()) as ParseResult;
      setResult(parsed);
      applyDetected(parsed);
      const detectedCount = Object.keys(parsed.core ?? {}).length;
      if (detectedCount === 0 && (parsed.extra?.length ?? 0) === 0) {
        setError("Couldn't read any trade details from the image — fill them in below.");
      }
    } catch {
      setError("Couldn't read the image — fill in the details below.");
      setValues({ direction: "long", status: "open" });
    }
    setStep("review");
  }

  // Allow pasting a screenshot straight from the clipboard while picking
  useEffect(() => {
    if (!open || step !== "pick") return;
    function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const pasted = item?.getAsFile();
      if (pasted) handleFile(pasted);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/trades", { method: "POST" });
      if (!res.ok) throw new Error();
      const trade = await res.json();

      const core: Record<string, unknown> = {
        ticker: values.ticker ?? "",
        direction: values.direction || null,
        status: values.status || "open",
      };
      for (const { key } of [...PRIMARY, ...MORE]) {
        if (key === "ticker" || key === "direction" || key === "status") continue;
        const raw = values[key];
        if (raw === undefined || raw === "") continue;
        core[key] = NUMERIC_KEYS.has(key) ? Number(raw) : raw;
      }

      const patchRes = await fetch(`/api/trades/${trade.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ core }),
      });
      if (!patchRes.ok) throw new Error();

      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        await fetch(`/api/trades/${trade.id}/images`, { method: "POST", body: formData }).catch(() => {});
      }

      router.push(`/trades/${trade.id}`);
    } catch {
      setError("Failed to create the trade — check your connection and try again.");
      setSubmitting(false);
    }
  }

  function badge(key: OcrCoreField) {
    const f = result?.core[key];
    if (!f) return null;
    return <ConfidenceBadge confidence={f.confidence} source={f.source} />;
  }

  // A field detected but below the auto-fill bar: offer it as a suggestion.
  function suggestion(key: OcrCoreField) {
    const f = result?.core[key];
    if (!f || f.confidence >= AUTOFILL_CONFIDENCE) return null;
    if (values[key]) return null;
    return (
      <button
        type="button"
        onClick={() => set(key, toInput(key, f.value))}
        className="mt-1 text-[11px] text-amber-500 hover:underline"
      >
        Detected {String(f.value)} ({Math.round(f.confidence * 100)}%) — use it?
      </button>
    );
  }

  function renderField({ key, label, type }: FieldDef) {
    return (
      <div key={key}>
        <label className={labelClass}>
          {label}
          {badge(key)}
        </label>
        {type === "direction" ? (
          <select className={inputClass} value={values.direction ?? "long"} onChange={(e) => set("direction", e.target.value)}>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        ) : type === "status" ? (
          <select className={inputClass} value={values.status ?? "open"} onChange={(e) => set("status", e.target.value)}>
            <option value="pending">Pending</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        ) : (
          <input
            type={type === "number" ? "number" : type === "date" ? "date" : "text"}
            step={type === "number" ? "any" : undefined}
            placeholder={type === "number" ? "0.00" : type === "text" ? "" : undefined}
            className={inputClass}
            value={values[key] ?? ""}
            onChange={(e) => set(key, key === "ticker" ? e.target.value.toUpperCase() : e.target.value)}
          />
        )}
        {suggestion(key)}
      </div>
    );
  }

  const moreDetected = MORE.filter((f) => result?.core[f.key] || values[f.key]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:border-zinc-500"
      >
        From screenshot
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={close}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Trade from Screenshot</h2>
              <p className="mb-4 text-xs text-zinc-500">
                Upload a screenshot of your fill, order, or position. It&apos;s parsed by the app&apos;s built-in
                reader — never sent to any third-party AI service or API.
              </p>

              {step === "pick" && (
                <>
                  <div
                    onDrop={(e) => {
                      e.preventDefault();
                      const dropped = e.dataTransfer.files[0];
                      if (dropped) handleFile(dropped);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-10 text-sm text-zinc-500 transition-colors hover:border-primary hover:text-primary"
                  >
                    Click, paste, or drag a screenshot here
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const selected = e.target.files?.[0];
                      if (selected) handleFile(selected);
                    }}
                  />

                  <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setShowExample((v) => !v)}
                      className="flex w-full items-center justify-between px-3 py-2 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                    >
                      <span>{showExample ? "Hide" : "Not sure what to screenshot?"} {showExample ? "" : "See an example"}</span>
                      <span className="text-[10px] text-zinc-400">{showExample ? "▲" : "▼"}</span>
                    </button>
                    {showExample && (
                      <div className="border-t border-zinc-200 dark:border-zinc-800 p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="/example-trade-screenshot.png"
                          alt="Example trade screenshot with Entry Price, Stop Loss, Take Profit, and Shares highlighted"
                          className="w-full rounded-xl"
                        />
                        <p className="mt-2 text-[11px] text-zinc-500">
                          Crop or capture a view that clearly shows the ticker, direction (long/short), and as many of
                          the highlighted fields as your broker shows — labeled or not, any layout, dark or light mode.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}

              {step === "scanning" && (
                <div className="flex flex-col items-center gap-3 py-6">
                  {previewUrl && <img src={previewUrl} alt="Screenshot preview" className="max-h-48 rounded-xl object-contain" />}
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-primary" />
                  <p className="text-xs text-zinc-500">Reading trade details from image...</p>
                </div>
              )}

              {step === "review" && (
                <div className="flex flex-col gap-3">
                  {previewUrl && <img src={previewUrl} alt="Screenshot preview" className="max-h-32 self-center rounded-xl object-contain" />}

                  {result && (result.broker || result.screenshotType !== "unknown") && (
                    <p className="text-[11px] text-zinc-500">
                      {result.broker ? `${result.broker} · ` : ""}
                      {result.screenshotType.replace(/_/g, " ")}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-3">{PRIMARY.map(renderField)}</div>

                  {moreDetected.length > 0 && (
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                      <button
                        type="button"
                        onClick={() => setShowMore((v) => !v)}
                        className="flex w-full items-center justify-between px-3 py-2 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        <span>
                          {showMore ? "Hide" : "Show"} {moreDetected.length} more detected field
                          {moreDetected.length > 1 ? "s" : ""}
                        </span>
                        <span className="text-[10px] text-zinc-400">{showMore ? "▲" : "▼"}</span>
                      </button>
                      {showMore && <div className="grid grid-cols-2 gap-3 border-t border-zinc-200 dark:border-zinc-800 p-3">{moreDetected.map(renderField)}</div>}
                    </div>
                  )}

                  {result && result.extra.length > 0 && (
                    <div className="rounded-lg bg-zinc-100 dark:bg-zinc-950 px-3 py-2">
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Also read (no field to save)</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {result.extra.map((e) => (
                          <span key={e.key} className="text-[11px] text-zinc-400">
                            {e.label}: <span className="text-zinc-600 dark:text-zinc-300">{String(e.value)}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-zinc-500">
                    Green = high confidence, amber = please check. Low-confidence values are left blank on purpose. The
                    screenshot is attached automatically.
                  </p>

                  {result?.log.rawText && (
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                      <button
                        type="button"
                        onClick={() => setShowRaw((v) => !v)}
                        className="flex w-full items-center justify-between px-3 py-2 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        <span>{showRaw ? "Hide" : "Show"} what the scan read</span>
                        <span className="text-[10px] text-zinc-400">{showRaw ? "▲" : "▼"}</span>
                      </button>
                      {showRaw && (
                        <div className="border-t border-zinc-200 dark:border-zinc-800 p-3">
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-100 dark:bg-zinc-950 p-2 text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
                            {result.log.rawText}
                          </pre>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(result.log.rawText).then(
                                () => {
                                  setCopied(true);
                                  setTimeout(() => setCopied(false), 1500);
                                },
                                () => {},
                              );
                            }}
                            className="mt-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-xs text-zinc-600 dark:text-zinc-300 hover:border-zinc-500"
                          >
                            {copied ? "Copied!" : "Copy text"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-2 flex items-center justify-between">
                    <button onClick={reset} disabled={submitting} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-50">
                      Try another image
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={submitting}
                      className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
                    >
                      {submitting ? "Creating..." : "Create trade"}
                    </button>
                  </div>
                </div>
              )}

              {error && <p className="mt-3 text-xs text-loss">{error}</p>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
