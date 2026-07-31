// Supabase's PostgREST caps any un-limited select at 1,000 rows and returns
// success -- there is no error, the tail of the table just silently isn't
// there. Every query in this app that aggregates over "all rows" (balance
// sums, analytics, exports, the background sweep) was subject to that cap,
// which is invisible at small scale and quietly wrong past it.
//
// This helper walks a query in pages until a short page signals the end.
// Callers hand it a factory because a PostgREST builder can't be re-ranged
// after execution -- each page needs a freshly built query.
//
// IMPORTANT: the factory's query must carry a deterministic `.order(...)`
// (unique column, or a tiebreaker on `id`). Offset pagination over an
// unordered set can repeat or skip rows between pages.

const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message?: string; code?: string } | null;
  }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    // A short page is the end. A full page might be exactly the last one,
    // which costs a single extra (empty) request -- correctness over the
    // saved round trip.
    if (rows.length < PAGE_SIZE) return all;
  }
}
