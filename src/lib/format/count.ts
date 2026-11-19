/**
 * "1 trade", "2 trades". The app printed "1 trades" in a dozen places (outside
 * review, 2026-11-14), so the word is chosen here instead of at each call.
 */
export function countOf(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** "Nov 2026" from a "2026-11" month key. Anything else is returned as given. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatMonthKey(key: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : key;
}
