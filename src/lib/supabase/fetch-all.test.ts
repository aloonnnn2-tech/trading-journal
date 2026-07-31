import { describe, it, expect } from "vitest";
import { fetchAllRows } from "./fetch-all";

// Simulates PostgREST's paged responses over a fixed dataset, including the
// 1,000-row page cap this helper exists to defeat.
function pagedSource(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const page = (from: number, to: number) => {
    calls.push([from, to]);
    return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
  };
  return { page, calls };
}

describe("fetchAllRows", () => {
  it("returns an empty set from an empty table in one call", async () => {
    const { page, calls } = pagedSource(0);
    expect(await fetchAllRows(page)).toEqual([]);
    expect(calls).toEqual([[0, 999]]);
  });

  it("fetches a sub-page table in one call", async () => {
    const { page, calls } = pagedSource(42);
    expect((await fetchAllRows(page)).length).toBe(42);
    expect(calls.length).toBe(1);
  });

  // The case the old unbounded queries got silently wrong.
  it("keeps going past the 1,000-row page cap", async () => {
    const { page } = pagedSource(2500);
    const rows = await fetchAllRows(page);
    expect(rows.length).toBe(2500);
    expect(rows[2499]).toEqual({ id: 2499 });
  });

  it("preserves order across page boundaries", async () => {
    const { page } = pagedSource(1001);
    const rows = await fetchAllRows(page);
    expect(rows[999]).toEqual({ id: 999 });
    expect(rows[1000]).toEqual({ id: 1000 });
  });

  it("spends one extra empty call when the table ends exactly on a page edge", async () => {
    const { page, calls } = pagedSource(1000);
    expect((await fetchAllRows(page)).length).toBe(1000);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("throws the page's error instead of returning a partial result", async () => {
    const failing = (from: number) =>
      Promise.resolve(
        from === 0
          ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
          : { data: null, error: { message: "boom" } },
      );
    await expect(fetchAllRows(failing)).rejects.toEqual({ message: "boom" });
  });

  it("treats a null data payload as the end rather than crashing", async () => {
    expect(await fetchAllRows(() => Promise.resolve({ data: null, error: null }))).toEqual([]);
  });
});
