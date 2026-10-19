import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toolDefsFor } from "./index";
import { tierPolicyFor } from "../tier";
import { viewTradeChart } from "./charts";
import type { ToolContext } from "./journal";

const IMG = "11111111-1111-4111-8111-111111111111";

/** trade_images as RLS shows it: only the asker's own row resolves. */
function ctxWith(vision: ToolContext["vision"], own: string[] = [IMG]): ToolContext {
  const supabase = {
    from: () => ({
      select: () => ({
        eq: (_k: string, id: string) => ({
          maybeSingle: async () => ({
            data: own.includes(id) ? { id, trade_id: "t1", storage_path: `u1/t1/${id}.png` } : null,
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { supabase, timezone: null, store: {} as never, outputBudget: 24_000, vision };
}

describe("view_trade_chart", () => {
  it("is only offered to providers whose models can see images", () => {
    const names = (vision: boolean) => toolDefsFor(tierPolicyFor("openai"), { vision }).map((t) => t.name);
    expect(names(true)).toContain("view_trade_chart");
    expect(names(false)).not.toContain("view_trade_chart");
    expect(toolDefsFor(tierPolicyFor("groq")).map((t) => t.name)).not.toContain("view_trade_chart");
  });

  it("attaches the asker's own screenshot by id -- never its bytes or its storage path", async () => {
    const out = await viewTradeChart(ctxWith("on"), { image_id: IMG }, { count: 0 });
    expect(out).toMatchObject({ ok: true, image_id: IMG, trade_id: "t1", attach: { type: "trade_image", id: IMG } });
    expect(JSON.stringify(out)).not.toContain("u1/t1");
  });

  it("can't reach a screenshot RLS doesn't show (someone else's, or deleted)", async () => {
    const out = await viewTradeChart(ctxWith("on", []), { image_id: IMG }, { count: 0 });
    expect(out).toHaveProperty("error");
    expect(out).not.toHaveProperty("attach");
  });

  it("tells the model how the user switches it on, instead of guessing at the chart", async () => {
    const out = (await viewTradeChart(ctxWith("no_consent"), { image_id: IMG }, { count: 0 })) as { error: string };
    expect(out.error).toMatch(/Let Ask see my chart screenshots/);
    expect(out).not.toHaveProperty("attach");
    expect(await viewTradeChart(ctxWith(undefined), { image_id: IMG }, { count: 0 })).toHaveProperty("error");
  });

  it("stops at three charts per question", async () => {
    const shown = { count: 0 };
    for (let i = 0; i < 3; i++) expect(await viewTradeChart(ctxWith("on"), { image_id: IMG }, shown)).toHaveProperty("ok");
    expect(await viewTradeChart(ctxWith("on"), { image_id: IMG }, shown)).toHaveProperty("error");
  });
});
