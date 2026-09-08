"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { PROVIDER_LABELS, type AIProviderName } from "@/lib/ai-keys/types";

/**
 * The one-time disclosure shown before any of a user's data is sent to a
 * given AI provider.
 *
 * Extracted from the Ask page so the AI review features show the *same*
 * agreement, recorded against the same per-provider record (0031). Two
 * hand-written versions of a data-sharing disclosure is how one of them ends
 * up describing less than it sends.
 *
 * `description` is a required prop with no default on purpose. Each feature
 * discloses a different amount -- the Ask page sends the whole journal, a
 * trade review sends one trade plus baselines -- and a shared default would
 * be wrong for whichever caller forgot to override it. Making it required
 * forces every new call site to state what it actually sends.
 */
export function ProviderConsentCard({
  provider,
  description,
  saving,
  onAccept,
  onCancel,
}: {
  provider: AIProviderName;
  description: ReactNode;
  saving: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  return (
    <Card hoverable={false} className="flex flex-col gap-3 border-amber-500/40">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Before this leaves your journal
      </h2>
      <p className="text-sm text-zinc-500">
        This is sent to{" "}
        <strong className="text-zinc-900 dark:text-zinc-100">{PROVIDER_LABELS[provider]}</strong>{" "}
        using your own API key. {description} That third party processes it under their terms, not
        ours. Your key stays encrypted here and is never shared.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={onAccept}
          disabled={saving}
          className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
        >
          {saving ? "Saving..." : "I understand. Send it"}
        </button>
        <button onClick={onCancel} className="text-sm text-zinc-500 hover:text-zinc-300">
          Cancel
        </button>
      </div>
    </Card>
  );
}
