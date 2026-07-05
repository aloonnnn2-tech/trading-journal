"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// "g" then a letter is a Gmail/Linear-style nav chord -- pressed within
// GO_CHORD_WINDOW_MS of each other, otherwise the "g" is dropped so a
// stray "g" while typing a ticker elsewhere doesn't arm the chord forever.
const GO_CHORD_WINDOW_MS = 1000;

const GO_ROUTES: Record<string, string> = {
  d: "/dashboard",
  t: "/trades",
  a: "/analytics",
  e: "/emotions",
  i: "/insights",
  f: "/fields",
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const [goArmed, setGoArmed] = useState(false);

  useEffect(() => {
    let goTimeout: ReturnType<typeof setTimeout> | null = null;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Escape") {
        setHelpOpen(false);
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (goArmed) {
        const route = GO_ROUTES[e.key.toLowerCase()];
        setGoArmed(false);
        if (goTimeout) clearTimeout(goTimeout);
        if (route) {
          e.preventDefault();
          router.push(route);
        }
        return;
      }

      if (e.key === "g") {
        setGoArmed(true);
        goTimeout = setTimeout(() => setGoArmed(false), GO_CHORD_WINDOW_MS);
        return;
      }

      if (e.key === "n") {
        e.preventDefault();
        fetch("/api/trades", { method: "POST" })
          .then((res) => res.json())
          .then((trade) => router.push(`/trades/${trade.id}`));
        return;
      }

      if (e.key === "/") {
        const search = document.getElementById("trade-search");
        if (search) {
          e.preventDefault();
          search.focus();
        }
        return;
      }

      if (e.key === "?") {
        setHelpOpen((open) => !open);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (goTimeout) clearTimeout(goTimeout);
    };
  }, [router, goArmed]);

  if (!helpOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="w-80 rounded-2xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Keyboard Shortcuts
        </h2>
        <dl className="flex flex-col gap-2 text-sm">
          <Row keys="n" label="New trade" />
          <Row keys="/" label="Focus search" />
          <Row keys="g d" label="Go to Dashboard" />
          <Row keys="g t" label="Go to Trades" />
          <Row keys="g a" label="Go to Analytics" />
          <Row keys="g e" label="Go to Emotions" />
          <Row keys="g i" label="Go to Insights" />
          <Row keys="g f" label="Go to Fields" />
          <Row keys="?" label="Toggle this help" />
        </dl>
      </div>
    </div>
  );
}

function Row({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <kbd className="rounded bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {keys}
      </kbd>
    </div>
  );
}