"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

// Copies text to the clipboard on the free-tool pages. The Clipboard API is
// local to the browser: nothing is sent anywhere. It can be refused (an
// insecure origin, a denied permission), so failure says so rather than
// pretending it worked.

type State = "idle" | "copied" | "failed";

export function CopyButton({
  text,
  label = "Copy",
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-primary hover:text-primary dark:border-subtle dark:text-zinc-400 print:hidden ${className}`}
    >
      {state === "copied" ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {/* Announced: the label itself changes, inside a live region. */}
      <span aria-live="polite">
        {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
      </span>
    </button>
  );
}
