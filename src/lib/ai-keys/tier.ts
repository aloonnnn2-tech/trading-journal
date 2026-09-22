import { FREE_TIER_PROVIDERS, type AIProviderName } from "./types";

/**
 * How generous the chat may be with a given provider.
 *
 * The free tiers this app supports are limited per MINUTE, not per request
 * -- Groq's is 8 000 tokens/minute -- and every turn re-sends the
 * conversation. So the limits that matter are on how much history rides
 * along, how big a tool result may be, and how many tool rounds run before
 * the model is asked to answer with what it has. A paid key has none of those
 * ceilings at this scale and gets room to work.
 *
 * The owner uses Groq day to day, so the free policy is the one most people
 * will actually live in. It is tuned to feel deliberate rather than broken:
 * three lookups is enough for a real question, and the UI names the limits
 * under the composer rather than letting a wall appear mid-conversation.
 */
export interface TierPolicy {
  /** Tool rounds run automatically per user message before "keep going?". */
  autoRounds: number;
  /** Which tool definitions are offered; "compact" is the short list with short descriptions. */
  toolSet: "full" | "compact";
  /** A tool result longer than this is replaced by an error asking the model to narrow it. */
  maxToolOutputChars: number;
  /** Characters of earlier conversation re-sent each turn. */
  historyBudgetChars: number;
  /** Tool-result bodies older than this many rounds are blanked to save tokens. */
  keepToolBodiesRounds: number;
  /** Whether a second model call may be spent on a conversation title. */
  modelTitle: boolean;
}

const PAID: TierPolicy = {
  autoRounds: 6,
  toolSet: "full",
  maxToolOutputChars: 24_000,
  historyBudgetChars: 40_000,
  keepToolBodiesRounds: 2,
  modelTitle: true,
};

const FREE: TierPolicy = {
  autoRounds: 3,
  toolSet: "compact",
  maxToolOutputChars: 6_000,
  historyBudgetChars: 7_000,
  keepToolBodiesRounds: 1,
  modelTitle: false,
};

// Google AI Studio's free tier is bounded by requests per minute far more
// than tokens, so it can carry the full tool set; only the round gate and
// title call stay conservative.
const GOOGLE_FREE: TierPolicy = { ...FREE, toolSet: "full", maxToolOutputChars: 16_000, historyBudgetChars: 24_000 };

export function tierPolicyFor(provider: AIProviderName): TierPolicy {
  if (provider === "google") return GOOGLE_FREE;
  return FREE_TIER_PROVIDERS.has(provider) ? FREE : PAID;
}

/** Hard server-side ceiling on tool rounds per user message, whatever the client asks. */
export const MAX_ROUNDS_PER_MESSAGE = 25;

/** One line for the UI, so the limits are stated rather than discovered. */
export function describeTier(provider: AIProviderName, label: string): string | null {
  const p = tierPolicyFor(provider);
  if (p === PAID) return null;
  const parts = [`up to ${p.autoRounds} lookups per question before it checks in`, "shorter data slices"];
  return `${label} free tier: ${parts.join(", ")}.`;
}
