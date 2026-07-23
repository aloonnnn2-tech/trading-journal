"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function DeleteAccountSection({ email }: { email: string }) {
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    setError(null);

    const res = await fetch("/api/account/delete", { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-loss px-4 py-2 text-sm font-medium text-loss hover:bg-loss/10"
      >
        Delete account
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-loss/40 bg-loss/5 p-4">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        Type <span className="font-mono font-semibold">{email}</span> to confirm.
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-loss"
        autoComplete="off"
      />
      {error && <p className="text-sm text-loss">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleDelete}
          disabled={confirmText !== email || loading}
          className="rounded-lg bg-loss px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Deleting..." : "Permanently delete my account"}
        </button>
        <button
          onClick={() => {
            setConfirming(false);
            setConfirmText("");
            setError(null);
          }}
          disabled={loading}
          className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
