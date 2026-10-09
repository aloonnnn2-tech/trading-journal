import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { Activity, ClickStat, ExitStat, FeedItem, Session } from "@/lib/tracking/activity";
import { formatRelative } from "../users/format";

// The Activity tab's building blocks, shared with the per-user page so both
// show events the same way (Problem 1 of the hardening brief). Server
// components: no client JS.

/** Renders a registry sentence, where **text** is the bold part. */
export function Sentence({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-zinc-900 dark:text-zinc-50">
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** "3m ago", with the exact UTC time on hover -- the server renders this, so
 *  a local clock time would be the server's zone, not the reader's. */
export function When({ iso }: { iso: string }) {
  const exact = `${iso.slice(0, 16).replace("T", " ")} UTC`;
  return (
    <time dateTime={iso} title={exact} className="whitespace-nowrap tabular-nums">
      {formatRelative(iso)}
    </time>
  );
}

export function durationText(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function UserCell({ userId, email, linkUsers }: { userId: string | null; email: string | null; linkUsers: boolean }) {
  const text = email ?? (userId ? `${userId.slice(0, 8)}…` : "unknown");
  if (!linkUsers || !userId) return <span className="truncate">{text}</span>;
  return (
    <Link href={`/admin/users/${userId}`} className="truncate hover:text-primary" data-track-private>
      {text}
    </Link>
  );
}

const EMPTY = "text-sm text-zinc-500";
const TH = "py-1.5 pr-4 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-500";
const TD = "py-1.5 pr-4 align-top";

export function FeedTable({
  items,
  showUser,
  showRaw,
}: {
  items: FeedItem[];
  showUser: boolean;
  showRaw: boolean;
}) {
  if (items.length === 0) return <p className={EMPTY}>Nothing recorded in this window.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-subtle">
            <th className={TH}>When</th>
            {showUser && <th className={TH}>Who</th>}
            <th className={TH}>What</th>
            <th className={TH}>Page</th>
          </tr>
        </thead>
        <tbody>
          {items.map((f, i) => (
            <tr key={`${f.at}-${i}`} className="border-b border-zinc-100 last:border-0 dark:border-subtle">
              <td className={`${TD} text-xs text-zinc-500`}>
                <When iso={f.at} />
              </td>
              {showUser && (
                <td className={`${TD} max-w-[14rem] text-xs text-zinc-600 dark:text-zinc-400`}>
                  <UserCell userId={f.userId} email={f.email} linkUsers />
                </td>
              )}
              <td className={`${TD} text-zinc-700 dark:text-zinc-300`}>
                <Sentence text={f.sentence} />
                {f.unmapped && (
                  <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    unmapped
                  </span>
                )}
                {showRaw && <div className="mt-0.5 break-all font-mono text-[11px] text-zinc-400">{f.raw}</div>}
              </td>
              <td className={TD}>
                {f.page && (
                  <span className="whitespace-nowrap rounded-full bg-zinc-500/10 px-2 py-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                    {f.page}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const EXIT_BADGE: Record<Session["exit"]["kind"], string> = {
  sent: "bg-primary/10 text-primary",
  inferred: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  active: "bg-profit/10 text-profit",
};

export function SessionsTable({ sessions, showUser }: { sessions: Session[]; showUser: boolean }) {
  if (sessions.length === 0) return <p className={EMPTY}>No browser sessions in this window.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-subtle">
            <th className={TH}>Started</th>
            {showUser && <th className={TH}>Who</th>}
            <th className={TH}>Length</th>
            <th className={TH}>Pages, in order</th>
            <th className={TH}>Left on</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="border-b border-zinc-100 last:border-0 dark:border-subtle">
              <td className={`${TD} text-xs text-zinc-500`}>
                <When iso={s.startedAt} />
              </td>
              {showUser && (
                <td className={`${TD} max-w-[14rem] text-xs text-zinc-600 dark:text-zinc-400`}>
                  <UserCell userId={s.userId} email={s.email} linkUsers />
                </td>
              )}
              <td className={`${TD} whitespace-nowrap tabular-nums text-zinc-700 dark:text-zinc-300`}>
                {durationText(s.durationSeconds)}
              </td>
              <td className={`${TD} text-xs text-zinc-600 dark:text-zinc-400`}>
                {s.pages.length ? s.pages.join(" → ") : "—"}
              </td>
              <td className={TD}>
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${EXIT_BADGE[s.exit.kind]}`}
                  title={
                    s.exit.kind === "sent"
                      ? "The browser reported leaving this page"
                      : s.exit.kind === "inferred"
                        ? "No exit was reported; the last page before 30 minutes of quiet"
                        : "Active in the last 30 minutes"
                  }
                >
                  {s.exit.kind === "active" ? "still active" : `${s.exit.page ?? "unknown"}${s.exit.kind === "inferred" ? " (inferred)" : ""}`}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExitsPanel({ exits }: { exits: ExitStat[] }) {
  return (
    <Card hoverable={false} className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Where users leave</h2>
        <p className="text-xs text-zinc-500">The page each finished session ended on.</p>
      </div>
      {exits.length === 0 ? (
        <p className={EMPTY}>No finished sessions in this window.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-subtle">
          {exits.map((e) => (
            <li key={e.page} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-300">
                {e.page}
                {e.inferred > 0 && (
                  <span className="ml-1.5 text-[11px] text-zinc-400">{e.inferred} inferred</span>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-zinc-900 dark:text-zinc-100">
                {e.count} <span className="text-xs text-zinc-500">· {Math.round(e.share * 100)}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ClicksPanel({ clicks, showRaw }: { clicks: ClickStat[]; showRaw: boolean }) {
  return (
    <Card hoverable={false} className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Most clicked</h2>
      {clicks.length === 0 ? (
        <p className={EMPTY}>No clicks recorded in this window.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-subtle">
          {clicks.slice(0, 20).map((c) => (
            <li key={c.raw} className="flex items-start justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0 text-zinc-700 dark:text-zinc-300">
                <Sentence text={c.name} />
                {c.page && <span className="ml-1.5 text-[11px] text-zinc-400">on {c.page}</span>}
                {showRaw && <span className="ml-1.5 font-mono text-[11px] text-zinc-400">({c.raw})</span>}
              </span>
              <span className="shrink-0 tabular-nums font-medium text-zinc-900 dark:text-zinc-100">{c.count}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ActivitySummary({ activity }: { activity: Activity }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
      <span>{activity.eventCount} events</span>
      <span aria-hidden>·</span>
      <span>{activity.sessions.length} sessions</span>
      {activity.unmappedCount > 0 && (
        <span
          className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400"
          title="Events with no readable name yet. Add them to src/lib/tracking/events.ts."
        >
          {activity.unmappedCount} unmapped
        </span>
      )}
    </p>
  );
}
