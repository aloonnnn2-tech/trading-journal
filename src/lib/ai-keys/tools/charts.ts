import { z } from "zod";
import { MAX_IMAGES_PER_QUESTION, findTradeImage } from "../vision";
import type { ToolContext } from "./journal";

// view_trade_chart: shows the model one of the trade's chart screenshots.
//
// The result itself is short text. Its `attach` field is what makes the
// chart reach the model: runTurn stores it as the tool row's `parts`, and
// each later request of the same question downloads the image and hands it
// to the provider with this result (src/lib/chat/turn.ts, hydrateImages).

export const viewTradeChartSchema = z.object({ image_id: z.string().uuid() }).strict();

export interface ChartAttachment {
  type: "trade_image";
  id: string;
}

export async function viewTradeChart(
  ctx: ToolContext,
  args: z.infer<typeof viewTradeChartSchema>,
  shown: { count: number },
) {
  if (ctx.vision !== "on" && ctx.vision !== "no_consent") {
    return { error: "This AI provider's models can't see images, so the chart can't be shown to you." };
  }
  if (ctx.vision === "no_consent") {
    return {
      error:
        'Chart viewing is switched off. Tell the user they can turn on "Let Ask see my chart screenshots" ' +
        "under the message box, then ask again. Until then you cannot see the chart -- don't guess what it shows.",
    };
  }
  if (shown.count >= MAX_IMAGES_PER_QUESTION) {
    return { error: `At most ${MAX_IMAGES_PER_QUESTION} charts per question. Answer from the ones you have.` };
  }
  const ref = await findTradeImage(ctx.supabase, args.image_id);
  if (!ref) return { error: "No screenshot with that id. Use an id from get_trade's `images`." };
  shown.count += 1;
  const attach: ChartAttachment = { type: "trade_image", id: ref.id };
  return {
    ok: true,
    image_id: ref.id,
    trade_id: ref.trade_id,
    attach,
    note:
      "The screenshot is attached to this result. Describe only what you can actually see in it -- " +
      "if part of it is unreadable or cut off, say so rather than filling it in.",
  };
}
