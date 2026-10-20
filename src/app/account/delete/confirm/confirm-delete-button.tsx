"use client";

import { useState } from "react";
import { FormError } from "@/components/form-error";
import { authApi } from "@/lib/auth/client-api";
import { endSession } from "@/lib/tracking/useAnalytics";

export function ConfirmDeleteButton() {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    let res: Response | null = null;
    try {
      res = await fetch("/api/account/delete", { method: "DELETE" });
    } catch {
      res = null;
    }
    if (!res || !res.ok) {
      const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
      setError(body.error ?? "Couldn't reach Trading Lens. Check your internet connection and try again.");
      setDeleting(false);
      return;
    }
    // The analytics session id belongs to the account that just ended, and
    // must not follow whoever signs in next.
    endSession();
    // Clears the (HttpOnly) cookies even though the account is already gone.
    await authApi.signOut();
    window.location.href = "/";
  }

  return (
    <div className="flex flex-col gap-3">
      <FormError>{error}</FormError>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="rounded-lg bg-loss px-4 py-2.5 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {deleting ? "Deleting..." : "Delete my account"}
      </button>
    </div>
  );
}
