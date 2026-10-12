"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ParseResult } from "@/lib/ocr/types";
import type { AiRowView } from "@/lib/ocr/ai-extract";
import { SCREENSHOT_AI_PROVIDERS } from "@/lib/ocr/ai-providers";
import { PROVIDER_LABELS, type AIProviderName, type StoredApiKey } from "@/lib/ai-keys/types";
import { ProviderConsentCard } from "@/components/ai/provider-consent-card";

// "Read with AI" on the screenshot review screen (Problem 2, part 2): a
// second reader on the user's own AI key, paid plan only. Renders nothing for
// a free account. The regular reading stays on screen until an AI result
// replaces it, and stays if the AI call fails.

export type AiParseResult = ParseResult & { rows?: AiRowView[] };

const SCREENSHOT_DISCLOSURE =
  "The screenshot image itself is sent, so the model can read the trade details on it — including anything else visible in the image.";

export function AiReadPanel({ file, onResult }: { file: File | null; onResult: (r: AiParseResult) => void }) {
  const [keys, setKeys] = useState<StoredApiKey[] | null>(null);
  const [keyId, setKeyId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentFor, setConsentFor] = useState<AIProviderName | null>(null);
  const [savingConsent, setSavingConsent] = useState(false);
  const [aiResult, setAiResult] = useState<AiParseResult | null>(null);
  const [rowIndex, setRowIndex] = useState(0);

  useEffect(() => {
    let live = true;
    // 401/403 = not signed in or not on the paid plan: the panel stays hidden.
    fetch("/api/ai-keys")
      .then((res) => (res.ok ? (res.json() as Promise<StoredApiKey[]>) : null))
      .then((list) => {
        if (!live || !list) return;
        const usable = list.filter((k) => k.is_active && SCREENSHOT_AI_PROVIDERS.has(k.provider));
        setKeys(usable);
        if (usable[0]) setKeyId(usable[0].id);
        else setKeys([]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (keys === null || !file) return null;

  if (keys.length === 0) {
    return (
      <p className="text-[11px] text-zinc-500">
        On your plan, an AI model on your own key can also read screenshots. It needs an OpenAI, Anthropic, Google,
        Mistral or OpenRouter key:{" "}
        <Link href="/ask" className="text-primary hover:underline">
          add one
        </Link>
        .
      </p>
    );
  }

  async function read() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("keyId", keyId);
      const res = await fetch("/api/ocr/ai", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as AiParseResult & { error?: string; needsConsent?: AIProviderName };
      if (res.status === 403 && body.needsConsent) {
        setConsentFor(body.needsConsent);
        return;
      }
      if (!res.ok) {
        setError(`${body.error ?? "The AI read failed."} The regular reading below is unchanged.`);
        return;
      }
      setAiResult(body);
      const first = Math.max(0, body.rows?.findIndex((r) => r.importable) ?? 0);
      setRowIndex(first);
      onResult(body);
    } catch {
      setError("Couldn't reach the AI. The regular reading below is unchanged.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptConsent() {
    if (!consentFor) return;
    setSavingConsent(true);
    try {
      const res = await fetch("/api/ai-keys/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: consentFor, scope: "screenshot_v1" }),
      });
      if (!res.ok) throw new Error();
      setConsentFor(null);
      await read();
    } catch {
      setError("Couldn't save your agreement. Try again.");
    } finally {
      setSavingConsent(false);
    }
  }

  function pickRow(i: number) {
    if (!aiResult?.rows?.[i]) return;
    setRowIndex(i);
    const row = aiResult.rows[i];
    onResult({ ...aiResult, core: row.core, warnings: row.warnings });
  }

  if (consentFor) {
    return (
      <ProviderConsentCard
        provider={consentFor}
        description={SCREENSHOT_DISCLOSURE}
        saving={savingConsent}
        onAccept={acceptConsent}
        onCancel={() => setConsentFor(null)}
      />
    );
  }

  const importableRows = (aiResult?.rows ?? []).map((r, i) => ({ ...r, i })).filter((r) => r.importable);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={read}
          disabled={busy || !keyId}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
        >
          {busy ? "Reading with AI…" : aiResult ? "Read again with AI" : "Read with AI"}
        </button>
        {keys.length > 1 ? (
          <select
            aria-label="Which AI key"
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
          >
            {keys.map((k) => (
              <option key={k.id} value={k.id}>
                {PROVIDER_LABELS[k.provider]}
                {k.label ? ` · ${k.label}` : ""}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[11px] text-zinc-500">with {PROVIDER_LABELS[keys[0].provider]}, on your own key</span>
        )}
      </div>
      {aiResult && (
        <p className="text-[11px] text-zinc-500">
          The form now shows the AI&apos;s reading. Values it was sure of, with the text it read, are filled in; the rest
          are suggestions. Check every field before saving.
        </p>
      )}
      {importableRows.length > 1 && (
        <label className="flex flex-col gap-1 text-[11px] text-zinc-500">
          The AI found {importableRows.length} orders. Which one is this trade?
          <select
            value={rowIndex}
            onChange={(e) => pickRow(Number(e.target.value))}
            className="rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
          >
            {importableRows.map((r) => (
              <option key={r.i} value={r.i}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-loss">
          {error}
        </p>
      )}
    </div>
  );
}
