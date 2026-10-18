import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeUserFiles, removeWaitlistEmail } from "./delete-account";

const U = "user-1";

/** A fake bucket: `tree` maps a folder to its entries (folders have id null). */
function fakeStorage(tree: Record<string, { name: string; id: string | null }[]>, opts: { removeError?: unknown; listError?: unknown } = {}) {
  const removed: string[][] = [];
  const listed: string[] = [];
  const bucket = {
    list: vi.fn(async (prefix: string, { offset }: { limit: number; offset: number }) => {
      listed.push(prefix);
      if (opts.listError) return { data: null, error: opts.listError };
      return { data: offset === 0 ? (tree[prefix] ?? []) : [], error: null };
    }),
    remove: vi.fn(async (paths: string[]) => {
      removed.push(paths);
      return { data: [], error: opts.removeError ?? null };
    }),
  };
  const storage = { from: (b: string) => (expect(b).toBe("trade-images"), bucket) };
  return { storage: storage as unknown as SupabaseClient["storage"], removed, listed };
}

describe("removeUserFiles", () => {
  it("removes every file in the user's folder, including ones no row names", async () => {
    const { storage, removed } = fakeStorage({
      [U]: [
        { name: "trade-a", id: null },
        { name: "trade-b", id: null },
      ],
      [`${U}/trade-a`]: [{ name: "1.png", id: "f1" }],
      [`${U}/trade-b`]: [
        { name: "2.jpg", id: "f2" },
        { name: "orphan.webp", id: "f3" },
      ],
    });
    const n = await removeUserFiles(storage, U, [`${U}/trade-a/1.png`]);
    expect(n).toBe(3);
    expect(removed.flat().sort()).toEqual([`${U}/trade-a/1.png`, `${U}/trade-b/2.jpg`, `${U}/trade-b/orphan.webp`]);
  });

  it("never removes a path outside the user's own folder, whatever a row says", async () => {
    const { storage, removed } = fakeStorage({ [U]: [] });
    const n = await removeUserFiles(storage, U, [
      "someone-else/trade/x.png",
      `${U}-evil/trade/x.png`,
      `${U}/../someone-else/x.png`,
      `${U}/trade/mine.png`,
    ]);
    expect(n).toBe(1);
    expect(removed.flat()).toEqual([`${U}/trade/mine.png`]);
  });

  it("removes in chunks", async () => {
    const files = Array.from({ length: 250 }, (_, i) => ({ name: `${i}.png`, id: `f${i}` }));
    const { storage, removed } = fakeStorage({ [U]: [{ name: "t", id: null }], [`${U}/t`]: files });
    expect(await removeUserFiles(storage, U, [])).toBe(250);
    expect(removed.map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it("throws on a listing or removal error instead of carrying on", async () => {
    await expect(removeUserFiles(fakeStorage({}, { listError: { message: "down" } }).storage, U, [])).rejects.toEqual({ message: "down" });
    const { storage } = fakeStorage({ [U]: [{ name: "a.png", id: "f" }] }, { removeError: { message: "nope" } });
    await expect(removeUserFiles(storage, U, [])).rejects.toEqual({ message: "nope" });
  });
});

describe("removeWaitlistEmail", () => {
  function fakeAdmin(rows: { id: string; email: string }[]) {
    const deleted: string[][] = [];
    const ilike = vi.fn();
    const admin = {
      from: (table: string) => {
        expect(table).toBe("waitlist");
        return {
          select: () => ({
            ilike: (col: string, value: string) => {
              ilike(col, value);
              return { limit: async () => ({ data: rows, error: null }) };
            },
          }),
          delete: () => ({
            in: async (_col: string, ids: string[]) => {
              deleted.push(ids);
              return { error: null };
            },
          }),
        };
      },
    };
    return { admin: admin as unknown as SupabaseClient, deleted, ilike };
  }

  it("deletes only the exact address, ignoring case", async () => {
    // a_b matches axb under ilike's wildcard rules; it must not be deleted.
    const { admin, deleted } = fakeAdmin([
      { id: "1", email: "A_B@Example.com" },
      { id: "2", email: "axb@example.com" },
    ]);
    expect(await removeWaitlistEmail(admin, "a_b@example.com")).toBe(1);
    expect(deleted).toEqual([["1"]]);
  });

  it("does nothing when there is no row", async () => {
    const { admin, deleted } = fakeAdmin([]);
    expect(await removeWaitlistEmail(admin, "nobody@example.com")).toBe(0);
    expect(deleted).toEqual([]);
  });
});
