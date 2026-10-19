import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getImageUsage, imageQuotaError } from "./quota";
import { MAX_IMAGE_BYTES_PER_USER, MAX_IMAGES_PER_USER } from "@/lib/limits";

const MB = 1024 * 1024;

/** A fake client whose trade_images holds `sizes`, read in pages like PostgREST. */
function fakeClient(sizes: (number | null)[], opts: { missingColumn?: boolean } = {}) {
  const calls: { select: string; eq: [string, string]; range?: [number, number] }[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe("trade_images");
      return {
        select(columns: string, options?: { count?: string; head?: boolean }) {
          const call: (typeof calls)[number] = { select: columns, eq: ["", ""] };
          calls.push(call);
          const chain = {
            eq(col: string, val: string) {
              call.eq = [col, val];
              if (options?.head) return Promise.resolve({ count: sizes.length, error: null });
              return chain;
            },
            range(from: number, to: number) {
              call.range = [from, to];
              if (opts.missingColumn) {
                return Promise.resolve({ data: null, error: { code: "42703", message: "column size_bytes does not exist" } });
              }
              return Promise.resolve({
                data: sizes.slice(from, to + 1).map((size_bytes) => ({ size_bytes })),
                error: null,
              });
            },
          };
          return chain;
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("getImageUsage", () => {
  it("counts files and sums bytes for the one user, null sizes as nothing", async () => {
    const { client, calls } = fakeClient([1000, null, 2500]);
    expect(await getImageUsage(client, "user-1")).toEqual({ files: 3, bytes: 3500 });
    expect(calls[0].eq).toEqual(["user_id", "user-1"]);
  });

  it("reads past PostgREST's 1,000-row page", async () => {
    const { client, calls } = fakeClient(Array.from({ length: 1500 }, () => 10));
    expect(await getImageUsage(client, "user-1")).toEqual({ files: 1500, bytes: 15000 });
    expect(calls.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("before 0074, still counts files and reports bytes as unknown", async () => {
    const { client } = fakeClient([1, 2, 3, 4], { missingColumn: true });
    expect(await getImageUsage(client, "user-1")).toEqual({ files: 4, bytes: null });
  });
});

describe("imageQuotaError", () => {
  it("allows an account under both limits", () => {
    expect(imageQuotaError({ files: 15, bytes: 0.4 * MB }, 30_000)).toBeNull();
  });

  it("refuses at the file-count limit", () => {
    expect(imageQuotaError({ files: MAX_IMAGES_PER_USER, bytes: 0 }, 1)).toMatch(/limit of 2,000 screenshots/);
  });

  it("refuses when the new file would pass the byte limit, and says how much is used", () => {
    const msg = imageQuotaError({ files: 10, bytes: MAX_IMAGE_BYTES_PER_USER - 100 }, 101);
    expect(msg).toMatch(/200 MB of the 200 MB/);
    expect(imageQuotaError({ files: 10, bytes: MAX_IMAGE_BYTES_PER_USER - 100 }, 100)).toBeNull();
  });

  it("skips the byte limit when sizes are unknown, but not the file count", () => {
    expect(imageQuotaError({ files: 10, bytes: null }, 4 * MB)).toBeNull();
    expect(imageQuotaError({ files: MAX_IMAGES_PER_USER, bytes: null }, 1)).not.toBeNull();
  });
});
