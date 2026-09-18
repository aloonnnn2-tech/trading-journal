import { formatDate } from "@/lib/dates/format";

// Shared by the (client) directory table and the (server) detail page. Kept
// in a plain module with no "use client" directive on purpose: importing a
// function out of a client component into a Server Component makes it a
// client reference, which cannot be called during a server render.

export function formatActive(seconds: number): string {
  if (seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

// "2 hours ago" beats a timestamp for a last-seen column: the question it
// answers is "is this person still around", not "when exactly".
export function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatDate(iso);
}
