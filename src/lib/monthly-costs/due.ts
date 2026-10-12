// Which months a monthly cost has come due in -- pure, so it is tested
// directly. Dates are calendar dates ("YYYY-MM-DD"), compared as strings,
// in UTC: a cost due on the 1st is taken on the 1st wherever the user is.

export interface MonthlyCost {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  currency: string | null;
  fx_rate: number | null;
  day_of_month: number;
  starts_on: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * How far back a newly created cost may reach. A cost dated two years ago
 * would otherwise take 24 withdrawals in one go -- almost never what someone
 * setting it up today means, and not something to do silently.
 */
export const MAX_BACKFILL_MONTHS = 12;

const pad = (n: number) => String(n).padStart(2, "0");

/** First-of-month keys ("2026-09-01") for every month the cost is due, oldest first. */
export function dueMonths(cost: Pick<MonthlyCost, "day_of_month" | "starts_on" | "active">, today: string): string[] {
  if (!cost.active) return [];
  const [sy, sm] = cost.starts_on.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  const out: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ty || (y === ty && m <= tm)) {
    const due = `${y}-${pad(m)}-${pad(cost.day_of_month)}`;
    if (due >= cost.starts_on && due <= today) out.push(`${y}-${pad(m)}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out.slice(-MAX_BACKFILL_MONTHS);
}

/** The day the cost is next taken, on or after `today`. */
export function nextDue(cost: Pick<MonthlyCost, "day_of_month" | "starts_on" | "active">, today: string): string | null {
  if (!cost.active) return null;
  const from = cost.starts_on > today ? cost.starts_on : today;
  let [y, m] = from.split("-").map(Number);
  for (let i = 0; i < 14; i++) {
    const due = `${y}-${pad(m)}-${pad(cost.day_of_month)}`;
    if (due >= from) return due;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return null;
}

/** The cost in the account's own currency. */
export function costInAccountCurrency(cost: Pick<MonthlyCost, "amount" | "currency" | "fx_rate">): number {
  const rate = cost.currency && cost.fx_rate ? Number(cost.fx_rate) : 1;
  return Math.round(Number(cost.amount) * rate * 100) / 100;
}

/**
 * Every withdrawal a monthly cost makes starts its note with this. It is how
 * the ledger tells them apart from the user's own deposits and withdrawals:
 * costs alone don't mean the user tracks cash (see hasOwnCashEntries).
 */
export const MONTHLY_COST_NOTE_PREFIX = "Monthly cost: ";

export function isMonthlyCostNote(note: string | null | undefined): boolean {
  return note != null && note.startsWith(MONTHLY_COST_NOTE_PREFIX);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 2026" for "2026-09-01". Locale-free, so server and client agree. */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
