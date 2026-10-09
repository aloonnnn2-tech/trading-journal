import { afterEach, describe, expect, it, vi } from "vitest";
import { aiReplySchema, aiReplyToResult, checkRow, rowToCore, type AiRow } from "./ai-extract";
import { shouldAutofill } from "./types";
import { getProvider } from "@/lib/ai-keys/providers";

const sure = <T>(value: T, source_text = String(value)) => ({ value, confidence: 0.95, source_text });

const buyRow: AiRow = {
  symbol: sure("aapl", "AAPL"),
  side: sure("buy" as const, "BUY"),
  quantity: sure(10, "10"),
  price: sure(190.12, "190.12"),
  total: sure(1901.2, "1,901.20"),
  order_type: sure("limit" as const, "LMT"),
  time_in_force: sure("gtc" as const, "GTC"),
  status: sure("filled" as const, "Filled"),
  executed_at: sure("2026-10-01T14:31:00Z", "10/01/26 10:31:00"),
};

describe("rowToCore: the model's row as the review screen's fields", () => {
  it("a filled buy: long entry, filled in where sure; status only suggested", () => {
    const core = rowToCore(buyRow);
    expect(core.ticker?.value).toBe("AAPL");
    expect(core.direction?.value).toBe("long");
    expect(core.entry_price?.value).toBe(190.12);
    expect(core.shares?.value).toBe(10);
    expect(core.order_type?.value).toBe("limit");
    expect(core.time_in_force?.value).toBe("gtc");
    expect(core.entry_date?.value).toBe("2026-10-01");
    for (const k of ["ticker", "direction", "entry_price", "shares", "order_type"] as const) {
      expect(shouldAutofill(core[k]), k).toBe(true);
    }
    // A fill says the order executed, not that the trade is still open.
    expect(core.status).toMatchObject({ value: "open", heuristic: true });
  });

  it("sell closes a long, cover closes a short: the price is the EXIT", () => {
    const sell = rowToCore({ ...buyRow, side: sure("sell" as const) });
    expect(sell.direction?.value).toBe("long");
    expect(sell.exit_price?.value).toBe(190.12);
    expect(sell.entry_price).toBeUndefined();
    expect(sell.exit_date?.value).toBe("2026-10-01");

    const cover = rowToCore({ ...buyRow, side: sure("cover" as const) });
    expect(cover.direction?.value).toBe("short");
    expect(cover.exit_price?.value).toBe(190.12);

    const short = rowToCore({ ...buyRow, side: sure("short" as const) });
    expect(short.direction?.value).toBe("short");
    expect(short.entry_price?.value).toBe(190.12);
  });

  it("never guesses: missing fields stay missing; unsure or unsourced ones are suggestions", () => {
    const core = rowToCore({
      symbol: sure("TSLA"),
      price: { value: 250, confidence: 0.6, source_text: "250" },
      quantity: { value: 5, confidence: 0.99, source_text: null },
    });
    expect(core.direction).toBeUndefined();
    expect(core.status).toBeUndefined();
    expect(core.entry_price).toMatchObject({ heuristic: true });
    expect(core.shares).toMatchObject({ heuristic: true });
  });

  it("an unfilled stop order's trigger is only an entry suggestion", () => {
    const core = rowToCore({
      symbol: sure("KHC"),
      side: sure("buy" as const),
      order_type: sure("stop" as const),
      stop_price: sure(25.58),
      status: sure("pending" as const),
    });
    expect(core.entry_price).toMatchObject({ value: 25.58, heuristic: true });
    expect(core.status).toMatchObject({ value: "pending" });
    expect(shouldAutofill(core.status)).toBe(true);
  });

  it("market-on-open is stored as Other with its own words", () => {
    const core = rowToCore({ ...buyRow, order_type: sure("market_on_open" as const, "MOO") });
    expect(core.order_type).toMatchObject({ value: "other", raw: "Market on open" });
  });
});

describe("checkRow: deterministic checks", () => {
  it("passes a consistent row", () => {
    expect(checkRow(buyRow, new Date("2026-10-09"))).toEqual([]);
  });

  it("flags qty x price vs total, but allows an options x100 multiplier", () => {
    expect(checkRow({ ...buyRow, total: sure(5000) })[0]).toMatch(/doesn't match the total/);
    expect(checkRow({ ...buyRow, quantity: sure(1), price: sure(9.7), total: sure(970) })).toEqual([]);
  });

  it("flags a stop-limit whose stop and limit are the wrong way round", () => {
    const w = checkRow({ ...buyRow, order_type: sure("stop_limit" as const), stop_price: sure(105), limit_price: sure(100) });
    expect(w.some((s) => /stop-limit/.test(s))).toBe(true);
  });

  it("flags future, ancient or unreadable dates and odd symbols", () => {
    const now = new Date("2026-10-09");
    expect(checkRow({ ...buyRow, executed_at: sure("2027-01-01") }, now)[0]).toMatch(/future/);
    expect(checkRow({ ...buyRow, executed_at: sure("1975-01-01") }, now)[0]).toMatch(/implausibly old/);
    expect(checkRow({ ...buyRow, executed_at: sure("yesterday-ish") }, now)[0]).toMatch(/couldn't be read/);
    expect(checkRow({ ...buyRow, symbol: sure("AAPL<script>") }, now)[0]).toMatch(/ticker symbol/);
  });
});

describe("aiReplyToResult", () => {
  it("offers only filled rows, counts the skipped ones, and suggestion-izes a row that fails a check", () => {
    const reply = aiReplySchema.parse({
      broker_detected: "Interactive Brokers",
      rows: [
        { ...buyRow, status: sure("cancelled") },
        { ...buyRow, total: sure(9999) },
        buyRow,
      ],
    });
    const r = aiReplyToResult(reply, "openai", "gpt-5-mini");
    expect(r.rows.map((x) => x.importable)).toEqual([false, true, true]);
    // The first importable row failed its check: nothing in it is filled in.
    expect(Object.values(r.core).every((f) => !shouldAutofill(f))).toBe(true);
    expect(r.warnings.some((w) => /1 cancelled or pending order was found/.test(w))).toBe(true);
    expect(r.broker).toBe("Interactive Brokers");
    expect(r.log.engine).toBe("ai:openai:gpt-5-mini");
  });

  it("says so when nothing was found", () => {
    const r = aiReplyToResult({ broker_detected: null, rows: [] }, "google", "m");
    expect(r.ok).toBe(false);
    expect(r.warnings[0]).toMatch(/no orders/);
  });

  it("refuses a malformed reply at the schema", () => {
    expect(aiReplySchema.safeParse({ rows: [{ quantity: { value: -3, confidence: 0.9 } }] }).success).toBe(false);
    expect(aiReplySchema.safeParse({ rows: "none" }).success).toBe(false);
  });
});

describe("providers send the image in their own format", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  function capture(response: unknown) {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? "{}"));
      return { ok: true, status: 200, json: async () => response, text: async () => "" };
    }) as unknown as typeof fetch;
    return bodies;
  }
  const images = [{ mime: "image/jpeg", base64: "QUJD" }];

  it("OpenAI-compatible: image_url data URL in the user content", async () => {
    const bodies = capture({ choices: [{ message: { content: "{}" } }] });
    await getProvider("openai").askQuestion("k", "sys", "read it", { images });
    const user = (bodies[0].messages as { role: string; content: unknown }[])[1];
    expect(user.content).toEqual([
      { type: "text", text: "read it" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
    ]);
  });

  it("Anthropic: a base64 image block before the text", async () => {
    const bodies = capture({ content: [{ type: "text", text: "{}" }] });
    await getProvider("anthropic").askQuestion("k", "sys", "read it", { images });
    const content = (bodies[0].messages as { content: unknown[] }[])[0].content;
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
    expect(content[1]).toEqual({ type: "text", text: "read it" });
  });

  it("Google: inlineData part before the text", async () => {
    const bodies = capture({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });
    await getProvider("google").askQuestion("k", "sys", "read it", { images });
    const parts = (bodies[0].contents as { parts: unknown[] }[])[0].parts;
    expect(parts[0]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "QUJD" } });
  });

  it("without images, the request is exactly what it was", async () => {
    const bodies = capture({ choices: [{ message: { content: "x" } }] });
    await getProvider("openai").askQuestion("k", "sys", "q");
    expect((bodies[0].messages as { content: unknown }[])[1].content).toBe("q");
  });
});
