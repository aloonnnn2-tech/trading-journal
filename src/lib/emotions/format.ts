// Shared by the Emotions page (server) and its rows (client): a function in a
// "use client" file can't be called while rendering on the server.

export function formatR(r: number | null): string {
  if (r == null) return "—";
  return `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`;
}

export function pct(rate: number | null): string {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}
