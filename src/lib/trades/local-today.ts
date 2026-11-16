/** Today as YYYY-MM-DD in the browser's zone -- the shape the date input stores.
 *  The chart reads a bare day as that day on the exchange (tradeMoment). */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
