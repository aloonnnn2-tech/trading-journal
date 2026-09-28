import { Download, History, KeyRound, type LucideIcon } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";

// The trust trio (Phase 3C of docs/design-audit.md, target order #11), in the
// wording Alon approved on 2026-09-27. Two of the spec's three titles were
// corrected against the code before they shipped:
//
//  - "Export everything" -> "Export every trade": api/trades/export sends
//    trades only, and XLSX is the one confirmed format (no CSV claim).
//  - "Every edit versioned" -> "Edit history on every trade": each trade
//    keeps its newest 50 versions (0023_trade_history_retention.sql).
//
// "Your AI key, never ours" is true of the code -- keys are AES-256-GCM
// encrypted at rest and decrypted per request (src/lib/ai-keys/crypto.ts) --
// but every AI route is paid-only and the paid plan isn't on sale, so the
// tile says so.

interface Tile {
  icon: LucideIcon;
  title: string;
  body: string;
  paid?: boolean;
}

const TILES: Tile[] = [
  {
    icon: KeyRound,
    title: "Your AI key, never ours",
    body: "The AI features run on a key from your own provider, billed to your account there. We store it encrypted and only decrypt it to make your request.",
    paid: true,
  },
  {
    icon: Download,
    title: "Export every trade",
    body: "Download your trades to Excel (XLSX) any time, on the free plan. Your record isn’t locked in.",
  },
  {
    icon: History,
    title: "Edit history on every trade",
    body: "Change a trade and the earlier version is kept. Replay the changes in order and restore any of the last 50.",
  },
];

export function TrustTrio() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 sm:px-10">
      <div className="grid gap-3 md:grid-cols-3">
        {TILES.map((tile, i) => (
          <Reveal
            key={tile.title}
            delay={i * 0.05}
            className={`flex flex-col gap-3 rounded-2xl border p-6 ${
              tile.paid
                ? "border-primary/25 bg-primary/[0.03] dark:bg-primary/[0.04]"
                : "border-zinc-200 bg-white dark:border-subtle dark:bg-card"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <tile.icon className="h-[18px] w-[18px]" strokeWidth={2} />
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                  tile.paid
                    ? "border-primary/40 text-primary"
                    : "border-zinc-200 text-zinc-400 dark:border-subtle dark:text-zinc-500"
                }`}
              >
                {tile.paid ? "Paid · coming soon" : "Free"}
              </span>
            </div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">{tile.title}</h3>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{tile.body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
