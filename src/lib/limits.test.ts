import { describe, expect, it } from "vitest";
import { isRowLimitError, ROW_LIMIT_MESSAGE, rowLimitResponse } from "./limits";

describe("row-cap errors (0067 / 0074)", () => {
  it("recognises Postgres' 54000 and nothing else", () => {
    expect(isRowLimitError({ code: "54000", message: "Row limit reached: trades allows at most 100000 rows per account." })).toBe(true);
    expect(isRowLimitError({ code: "23505" })).toBe(false);
    expect(isRowLimitError(new Error("54000"))).toBe(false);
    expect(isRowLimitError(null)).toBe(false);
    expect(isRowLimitError(undefined)).toBe(false);
  });

  it("answers a row-cap error with a 429 that names no table or number", async () => {
    const res = rowLimitResponse({ code: "54000", message: "Row limit reached: trades allows at most 100000 rows per account." });
    expect(res?.status).toBe(429);
    const body = await res!.json();
    expect(body).toEqual({ error: ROW_LIMIT_MESSAGE });
    expect(JSON.stringify(body)).not.toMatch(/trades|100000/);
  });

  it("leaves every other error to the caller", () => {
    expect(rowLimitResponse({ code: "42P01" })).toBeNull();
    expect(rowLimitResponse(new Error("boom"))).toBeNull();
  });
});
