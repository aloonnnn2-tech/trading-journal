"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import exampleTradeScreenshot from "../../../public/example-trade-screenshot.png";
import { ALLOWED_IMAGE_TYPES } from "@/lib/images/queries";
import type { OcrCoreField, ParseResult } from "@/lib/ocr/types";
import { shouldAutofill } from "@/lib/ocr/types";
import { ConfidenceBadge } from "@/components/ocr/ConfidenceBadge";
import { FormError } from "@/components/form-error";
import { useDialog } from "@/lib/a11y/use-dialog";
import { deriveBatchedMoneyFields } from "@/lib/trades/derive-inputs";
import type { EditableCoreField, Trade } from "@/lib/trades/types";
import { entryPriceLabels } from "@/lib/trades/order-labels";
import { AiReadPanel } from "./ai-read-panel";
import { signalReviewWow } from "@/lib/reviews/signals";
import { MAX_UPLOAD_BYTES, UPLOAD_TOO_LARGE } from "@/lib/http/upload-limits";
import { newIdempotencyKey } from "@/lib/http/idempotency-key";
import { failureMessage } from "@/lib/api/failure-message";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";
const labelClass = "mb-1 flex items-center text-xs font-medium text-zinc-500";

type Step = "pick" | "scanning" | "review";
type FieldType = "text" | "number" | "date" | "direction" | "status" | "order_type" | "time_in_force";

interface FieldDef {
  key: OcrCoreField;
  label: string;
  type: FieldType;
}

// Order Type sits with Direction and Status: it used to be folded away under
// "Show N more detected fields", so a type the reader DID capture went
// unseen -- and it now decides the "at what price did it fill?" question.
const PRIMARY: FieldDef[] = [
  { key: "ticker", label: "Ticker", type: "text" },
  { key: "direction", label: "Direction", type: "direction" },
  { key: "order_type", label: "Order Type", type: "order_type" },
  { key: "status", label: "Status", type: "status" },
  { key: "entry_price", label: "Entry Price", type: "number" },
  { key: "exit_price", label: "Exit Price", type: "number" },
  { key: "stop_loss", label: "Stop Loss", type: "number" },
  { key: "take_profit", label: "Take Profit", type: "number" },
  { key: "shares", label: "Number of Shares", type: "number" },
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
  { key: "limit_price", label: "Limit Price (stop-limit)", type: "number" },
  { key: "time_in_force", label: "Time in Force", type: "time_in_force" },
];

// Without these the trade can't be saved honestly, and nothing may stand in
// for them: an unread direction used to default to "long" and status to
// "open", so a short trade saved as long without a word on screen.
const REQUIRED: OcrCoreField[] = ["ticker", "direction", "status"];

const ORDER_TYPE_OPTIONS: [string, string][] = [
  ["market", "Market"],
  ["limit", "Limit"],
  ["stop", "Stop"],
  ["stop_limit", "Stop limit"],
  ["trailing_stop", "Trailing stop"],
  ["other", "Other"],
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
  "limit_price",
]);
const DATE_KEYS = new Set<OcrCoreField>(["entry_date", "exit_date"]);

/** The entries that hold something, so a sample's defaults only fill blanks. */
function dropBlank(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
}

function toInput(key: OcrCoreField, value: unknown): string {
  if (value == null) return "";
  if (DATE_KEYS.has(key)) return String(value).slice(0, 10);
  return String(value);
}

/** `label` for the empty-journal banner (4D); the header keeps the default. */
export function ScreenshotTradeButton({
  accountBalance = null,
  label = "From screenshot",
}: {
  accountBalance?: number | null;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        data-tour-id="trades-screenshot"
        className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:border-zinc-500"
      >
        {label}
      </button>
      <ScreenshotTradeDialog open={open} onClose={() => setOpen(false)} accountBalance={accountBalance} />
    </>
  );
}

/**
 * A new account's first screen (onboarding, 2026-11-19): the same dialog, as
 * "Log your first trade", with a sample screenshot to try and a way out to
 * typing it or skipping. Every path ends with the caller told what happened.
 */
export interface FirstRunHandlers {
  onCreated: (tradeId: string, path: "screenshot" | "sample") => void;
  onTypeInstead: () => void;
  onSkip: () => void;
}

export function ScreenshotTradeDialog({
  open,
  onClose,
  accountBalance = null,
  firstRun,
}: {
  open: boolean;
  onClose: () => void;
  accountBalance?: number | null;
  firstRun?: FirstRunHandlers;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("pick");
  // Reading the bundled example rather than the user's own screenshot.
  const [sample, setSample] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const createBusy = useRef(false);
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
    setSample(false);
  }

  function close() {
    if (submitting || step === "scanning") return;
    // First run: leaving the review goes back to the first screen. Leaving
    // the first screen itself takes the "Skip for now" button -- a stray tap
    // on the backdrop or Escape must not end onboarding for good.
    if (firstRun) {
      if (step === "review") reset();
      return;
    }
    reset();
    onClose();
  }

  // "Try a sample trade": the example screenshot, read by the same reader a
  // real one goes through, so the first thing a new user sees is the feature
  // working, not a description of it.
  async function trySample() {
    if (loadingSample) return;
    setLoadingSample(true);
    setError(null);
    try {
      const blob = await (await fetch(exampleTradeScreenshot.src)).blob();
      setSample(true);
      await handleFile(new File([blob], "sample-trade.png", { type: blob.type || "image/png" }), true);
    } catch {
      setError("Couldn't load the sample. Try your own screenshot, or type the trade in.");
    } finally {
      setLoadingSample(false);
    }
  }

  // Escape, focus trap, scroll lock and focus restore. This dialog had none of
  // them: it could only be dismissed by clicking the backdrop, which is not
  // something a keyboard user can do, and it scrolls internally
  // (max-h-[90vh] overflow-y-auto) so tabbing out of it was especially easy.
  const fieldId = useId();
  const dialogRef = useDialog({
    open,
    onClose: close,
    // Matches the guard `close()` already applies -- a scan or a submit in
    // flight shouldn't be abandonable with a keystroke.
    closeOnEscape: !submitting && step !== "scanning",
  });

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  // Fills only what was read beside its own label with confidence. Nothing
  // is assumed: no default direction or status, and an exit price no longer
  // flips the status to Closed (it can be a target, not a fill). Everything
  // else is a suggestion the user accepts, or left blank for them.
  function applyDetected(parsed: ParseResult) {
    const next: Record<string, string> = {};
    for (const key of [...PRIMARY, ...MORE].map((f) => f.key)) {
      const f = parsed.core[key];
      if (shouldAutofill(f)) next[key] = toInput(key, f!.value);
    }
    setValues(next);
  }

  async function handleFile(selected: File, isSample = false) {
    setError(null);
    if (!ALLOWED_IMAGE_TYPES.has(selected.type)) {
      setError("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
      return;
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setError(UPLOAD_TOO_LARGE);
      return;
    }

    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    setStep("scanning");

    try {
      const formData = new FormData();
      formData.append("file", selected);
      const res = await fetch("/api/ocr/parse", { method: "POST", body: formData });
      const body = (await res.json()) as ParseResult;
      // The route always responds 200 with a full ParseResult shape, even on
      // an internal OCR failure -- but a platform-level failure (e.g. the
      // function itself erroring out) can return a non-2xx with a different
      // body shape entirely. Treat that the same as a network failure rather
      // than feeding a malformed object into applyDetected below.
      if (!res.ok || !body.core) throw new Error("OCR request failed");
      // Lists added later (warnings, 2026-10) are absent from older answers;
      // the review screen reads their length.
      const parsed: ParseResult = { ...body, extra: body.extra ?? [], warnings: body.warnings ?? [] };
      setResult(parsed);
      applyDetected(parsed);
      // The sample is a known picture: an AAPL limit buy (public/example-trade-
      // screenshot.png). Whatever the reader leaves blank of the three fields
      // a trade can't be saved without is filled from that, so trying the
      // sample is one more click, not a form to work out.
      if (isSample) {
        setValues((prev) => ({ ticker: "AAPL", direction: "long", status: "open", ...dropBlank(prev) }));
      }
      const detectedCount = Object.keys(parsed.core ?? {}).length;
      if (detectedCount === 0 && (parsed.extra?.length ?? 0) === 0) {
        setError("Couldn't read any trade details from the image. Fill them in below.");
      }
    } catch {
      setError("Couldn't read the image. Fill in the details below.");
      setValues({});
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
    // A ref, not `submitting`: a double click fires both handlers before
    // the button re-renders as disabled.
    if (createBusy.current) return;
    createBusy.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // REQUIRED fields are checked before this can run (the button is
      // disabled until they are filled), so nothing here falls back to a
      // default value.
      const core: Record<string, unknown> = {
        ticker: values.ticker,
        direction: values.direction,
        status: values.status,
      };
      for (const { key } of [...PRIMARY, ...MORE]) {
        if (key === "ticker" || key === "direction" || key === "status") continue;
        const raw = values[key];
        if (raw === undefined || raw === "") continue;
        core[key] = NUMERIC_KEYS.has(key) ? Number(raw) : raw;
      }
      // "Other" keeps the words the screenshot used ("Market on open").
      if (core.order_type === "other" && result?.core.order_type?.raw) {
        core.order_type_other = result.core.order_type.raw.slice(0, 64);
      }

      // A screenshot showing Entry/Stop/Shares but no explicit Risk Amount
      // (most order tickets don't print one) used to save with Risk Amount
      // blank and no R Multiple, despite every input needed to compute it
      // having just been detected -- this runs the same derivation the
      // trade page itself uses for a normal one-field-at-a-time edit.
      const moneyEdits = (
        [
          ["entry_price", core.entry_price],
          ["stop_loss", core.stop_loss],
          ["shares", core.shares],
          ["dollar_amount", core.dollar_amount],
        ] as [EditableCoreField, unknown][]
      ).filter(([, value]) => value != null);
      const derivedMoney = deriveBatchedMoneyFields(
        moneyEdits,
        { entry_price: null, shares: null, dollar_amount: null, stop_loss: null, risk_amount: null },
        accountBalance,
      );
      // Only fills in what the review form didn't already provide --
      // deriveBatchedMoneyFields' own explicitKeys guard only covers the
      // four fields fed into it above, not e.g. a risk_amount the user
      // typed by hand in the review form, which must still win.
      for (const [field, value] of Object.entries(derivedMoney)) {
        if (!(field in core)) core[field] = value;
      }

      // One request with the details: a create followed by a separate PATCH
      // left a blank trade behind whenever the PATCH failed. The server now
      // saves both or neither.
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": newIdempotencyKey() },
        body: JSON.stringify({ core }),
      });
      if (!res.ok) {
        setError(await failureMessage(res, "Failed to create the trade. Try again."));
        setSubmitting(false);
        createBusy.current = false;
        return;
      }
      const trade = (await res.json()) as { id: string };

      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        await fetch(`/api/trades/${trade.id}/images`, { method: "POST", body: formData }).catch(() => {});
      }

      // A screenshot just became a trade: a good moment to ask for a review
      // (the card waits until this dialog is gone). Not for the sample: the
      // user hasn't imported anything of their own yet.
      if (!sample) signalReviewWow("wow_import");
      firstRun?.onCreated(trade.id, sample ? "sample" : "screenshot");
      router.push(`/trades/${trade.id}`);
    } catch {
      setError("Failed to create the trade. Check your connection and try again.");
      createBusy.current = false;
      setSubmitting(false);
    }
  }

  // The hover text names where the value came from and the exact text the
  // reader saw, so a wrong number can be traced to what was on screen.
  function badge(key: OcrCoreField) {
    const f = result?.core?.[key];
    if (!f) return null;
    const source = f.raw ? `${f.source} · read "${f.raw}"` : f.source;
    return <ConfidenceBadge confidence={f.confidence} source={source} />;
  }

  // Read, but not certain enough to fill in by itself -- found by a pattern,
  // an ambiguous word ("Sell", "Filled"), or a greyed-out box. Offered with
  // its reason; it lands in the form only if the user clicks it.
  function suggestion(key: OcrCoreField) {
    const f = result?.core?.[key];
    if (!f || shouldAutofill(f)) return null;
    if (values[key]) return null;
    const shown = key === "order_type" ? ORDER_TYPE_OPTIONS.find(([v]) => v === f.value)?.[1] ?? String(f.value) : String(f.value);
    return (
      <button
        type="button"
        onClick={() => set(key, toInput(key, f.value))}
        title={f.raw ? `Read "${f.raw}"` : undefined}
        className="mt-1 block text-left text-[11px] text-amber-600 hover:underline dark:text-amber-400"
      >
        Maybe {shown}? ({f.source}). Use it
      </button>
    );
  }

  const missing = REQUIRED.filter((k) => !values[k]);

  function renderField({ key, label, type }: FieldDef) {
    // One id per field, tying the <label> to the control it names. The label
    // used to wrap neither the input nor an htmlFor, so every field in this
    // dialog -- the whole point of the screenshot flow -- reached a screen
    // reader as an unlabelled edit box.
    //
    // The confidence badge is a <button>, so it sits outside the <label>
    // rather than inside it: a control nested in a label steals the label's
    // click, and clicking "Use it?" would also focus the field behind it.
    const controlId = `${fieldId}-${key}`;
    return (
      <div key={key}>
        <div className={labelClass}>
          <label htmlFor={controlId}>{label}</label>
          {badge(key)}
          {REQUIRED.includes(key) && !values[key] && (
            <span className="ml-1.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              needs your input
            </span>
          )}
        </div>
        {type === "direction" ? (
          <select id={controlId} className={inputClass} value={values.direction ?? ""} onChange={(e) => set("direction", e.target.value)}>
            <option value="" disabled>
              Choose…
            </option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        ) : type === "status" ? (
          <select id={controlId} className={inputClass} value={values.status ?? ""} onChange={(e) => set("status", e.target.value)}>
            <option value="" disabled>
              Choose…
            </option>
            <option value="pending">Pending</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        ) : type === "order_type" ? (
          <select id={controlId} className={inputClass} value={values.order_type ?? ""} onChange={(e) => set("order_type", e.target.value)}>
            <option value="">Not shown / unknown</option>
            {ORDER_TYPE_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        ) : type === "time_in_force" ? (
          <select id={controlId} className={inputClass} value={values.time_in_force ?? ""} onChange={(e) => set("time_in_force", e.target.value)}>
            <option value="">Not shown / unknown</option>
            <option value="gtc">Good till cancelled</option>
            <option value="day">Day</option>
          </select>
        ) : (
          <input
            id={controlId}
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

  // The order's own prices, named for its type with the trade page's names
  // ("Stop Price (trigger)", "Limit Price"). A stop-limit has two, so its
  // Limit Price sits beside the entry instead of folded away -- also when the
  // type is changed by hand (Alon's VEEV ticket, 2026-10-11).
  const priceNames = entryPriceLabels((values.order_type || null) as Trade["order_type"], !values.status || values.status === "pending");
  const showLimit = values.order_type === "stop_limit";
  const mainFields: FieldDef[] = PRIMARY.flatMap((f) =>
    f.key === "entry_price"
      ? [{ ...f, label: priceNames.entry }, ...(showLimit ? [{ key: "limit_price", label: "Limit Price", type: "number" } as FieldDef] : [])]
      : [f],
  );
  const moreDetected = MORE.filter((f) => !(showLimit && f.key === "limit_price") && (result?.core?.[f.key] || values[f.key]));

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, pointerEvents: "auto" }}
            // Click-through while it fades out, so it can't swallow the next click.
            exit={{ opacity: 0, pointerEvents: "none" }}
            className={`dialog-backdrop fixed inset-0 flex items-center justify-center p-4 ${
              firstRun ? "z-[200] bg-black/70 backdrop-blur-sm" : "z-50 bg-black/40"
            }`}
            onClick={close}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="dialog-panel max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-6"
              onClick={(e) => e.stopPropagation()}
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${fieldId}-title`}
              tabIndex={-1}
            >
              <h2
                id={`${fieldId}-title`}
                className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50"
              >
                {firstRun ? (sample ? "Your sample trade" : "Log your first trade") : "Trade from Screenshot"}
              </h2>
              {firstRun && sample ? (
                <p className="mb-4 text-sm text-zinc-500">
                  Read from an example order ticket, the way yours will be. Check it, then create it. It&apos;s a normal
                  trade you can delete any time.
                </p>
              ) : firstRun ? (
                // How to do it, in three plain steps, right after "How did you
                // hear about us?" (Alon, 2026-11-19): a new user should know
                // what to do before being asked to do it.
                <ol className="mb-4 flex flex-col gap-2.5 text-sm text-zinc-600 dark:text-zinc-300">
                  {[
                    ["Take a screenshot", "of the trade in your broker's app: the order ticket, the fill, or the open position."],
                    ["Drop it in the box below.", "The app reads the ticker, price, size, stop and target for you."],
                    ["Check the details and tap Create trade.", "That's it, it's in your journal."],
                  ].map(([lead, rest], i) => (
                    <li key={lead} className="flex gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                      >
                        {i + 1}
                      </span>
                      <span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">{lead}</span> {rest}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mb-4 text-xs text-zinc-500">
                  Upload a screenshot of your fill, order, or position. It&apos;s read by the app&apos;s built-in
                  reader. It goes to an AI service only if you choose &ldquo;Read with AI&rdquo; (paid plan, your own
                  key).
                </p>
              )}

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

                  {firstRun && (
                    <div className="mt-3 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={trySample}
                        disabled={loadingSample}
                        className="w-full rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60 dark:text-zinc-950"
                      >
                        {loadingSample ? "Loading the sample…" : "No screenshot handy? Try a sample trade"}
                      </button>
                      <p className="text-center text-xs text-zinc-500">
                        Or type it in yourself: a ticker, long or short, and a price is all it needs.
                      </p>
                      <div className="flex items-center justify-between pt-1 text-sm">
                        <button
                          type="button"
                          onClick={() => {
                            reset();
                            firstRun.onTypeInstead();
                          }}
                          className="text-zinc-600 hover:text-primary dark:text-zinc-300"
                        >
                          Type it in instead
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            reset();
                            firstRun.onSkip();
                          }}
                          className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                        >
                          Skip for now
                        </button>
                      </div>
                    </div>
                  )}

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
                        <Image
                          src={exampleTradeScreenshot}
                          alt="Example trade screenshot with Entry Price, Stop Loss, Take Profit, and Shares highlighted"
                          className="w-full h-auto rounded-xl"
                        />
                        <p className="mt-2 text-[11px] text-zinc-500">
                          Crop or capture a view that clearly shows the ticker, direction (long/short), and as many of
                          the highlighted fields as your broker shows. Labeled or not, any layout, dark or light mode.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}

              {step === "scanning" && (
                <div className="flex flex-col items-center gap-3 py-6">
                  {previewUrl && (
                    <div className="relative h-48 w-full">
                      <Image src={previewUrl} alt="Screenshot preview" fill unoptimized className="rounded-xl object-contain" />
                    </div>
                  )}
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-primary" />
                  <p className="text-xs text-zinc-500">Reading trade details from image...</p>
                </div>
              )}

              {step === "review" && (
                <div className="flex flex-col gap-3">
                  {previewUrl && (
                    <div className="relative h-32 w-full">
                      <Image src={previewUrl} alt="Screenshot preview" fill unoptimized className="rounded-xl object-contain" />
                    </div>
                  )}

                  {result && (result.broker || result.screenshotType !== "unknown") && (
                    <p className="text-[11px] text-zinc-500">
                      {result.broker ? `${result.broker} · ` : ""}
                      {result.screenshotType.replace(/_/g, " ")}
                    </p>
                  )}

                  <AiReadPanel
                    file={file}
                    onResult={(r) => {
                      setResult(r);
                      applyDetected(r);
                      setError(null);
                    }}
                  />

                  {/* Not for the sample: the example image prints a risk/reward
                      (8.42) its own prices don't give (2.14), and a new user's
                      first look at the reader shouldn't be a warning about our
                      picture. A real screenshot's warnings always show. */}
                  {result && !sample && result.warnings.length > 0 && (
                    <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                      <p className="mb-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">Check before saving</p>
                      <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-zinc-600 dark:text-zinc-300">
                        {result.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {result?.duplicates && result.duplicates.length > 0 && (
                    <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                      <p className="mb-1 font-semibold text-amber-700 dark:text-amber-400">
                        This looks like a trade you already have
                      </p>
                      {result.duplicates.map((d) => (
                        <a key={d.id} href={`/trades/${d.id}`} target="_blank" rel="noreferrer" className="mr-3 text-primary hover:underline">
                          {d.status} trade{d.entryDate ? ` from ${d.entryDate.slice(0, 10)}` : ""}
                        </a>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{mainFields.map(renderField)}</div>

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
                      {showMore && <div className="grid grid-cols-1 gap-3 border-t border-zinc-200 dark:border-zinc-800 p-3 sm:grid-cols-2">{moreDetected.map(renderField)}</div>}
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
                    Values read next to their own label are filled in. Anything uncertain is shown as a suggestion you
                    can accept, and anything not read is left blank for you. Nothing is guessed. The screenshot is
                    attached automatically.
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

                  {missing.length > 0 && (
                    <p className="text-right text-[11px] text-amber-700 dark:text-amber-400">
                      Fill in {missing.map((k) => [...PRIMARY, ...MORE].find((f) => f.key === k)?.label ?? k).join(", ")} to
                      create the trade.
                    </p>
                  )}
                  {/* Pinned to the bottom of the dialog, so on a phone Create
                      trade is in reach without scrolling past every field. */}
                  <div className="sticky -bottom-6 -mx-6 mt-2 flex items-center justify-between border-t border-zinc-200 bg-white px-6 pb-6 pt-3 dark:border-subtle dark:bg-card">
                    <button onClick={reset} disabled={submitting} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-50">
                      Try another image
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={submitting || missing.length > 0}
                      className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
                    >
                      {submitting ? "Creating..." : "Create trade"}
                    </button>
                  </div>
                </div>
              )}

              <FormError size="xs" className="mt-3">{error}</FormError>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
