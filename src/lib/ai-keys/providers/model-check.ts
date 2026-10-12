import { PROVIDER_MODEL_CHOICES, type AIProviderName } from "../types";

// Which model a key should ask, decided against the provider's LIVE list.
//
// Every provider here retires models on its own schedule, and nothing in a
// build or test run would catch it -- a hard-coded id only fails when someone
// asks a question. So the /models response that key validation already
// fetches (it costs no tokens) is read for its ids, and `chooseModel` picks
// the first of this app's choices that is still on it. The route stores the
// pick on the key, and re-picks the same way when a model vanishes later.

/** Pulls the model ids out of each provider's /models response shape. */
export function extractModelIds(body: unknown, provider: AIProviderName): string[] {
  const json = body as Record<string, unknown>;

  // Google returns `{ models: [{ name: "models/gemini-x" }] }`; everything
  // else in this app returns OpenAI's `{ data: [{ id }] }`.
  if (provider === "google") {
    const models = Array.isArray(json?.models) ? json.models : [];
    return models
      .map((m) => (m as { name?: unknown }).name)
      .filter((n): n is string => typeof n === "string")
      .map((n) => n.replace(/^models\//, ""));
  }

  // GitHub Models' catalog is a bare top-level array of `{ id, name, ... }`,
  // not wrapped in `data`. The id is already namespaced (`openai/gpt-4o-mini`),
  // matching what PROVIDER_MODELS stores and what /chat/completions wants.
  if (provider === "github") {
    const models = Array.isArray(body) ? body : [];
    return models
      .map((m) => (m as { id?: unknown }).id)
      .filter((id): id is string => typeof id === "string");
  }

  const data = Array.isArray(json?.data) ? json.data : [];
  return data
    .map((m) => (m as { id?: unknown }).id)
    .filter((id): id is string => typeof id === "string");
}

/**
 * The ids in a /models response, or `[]` when the body is unreadable.
 *
 * `[]` means "we don't know", never "the provider has no models": a key that
 * just authenticated must not be rejected because a response shape changed.
 * `chooseModel` treats an empty list as "trust the first choice".
 */
export async function readModelIds(res: Response, provider: AIProviderName): Promise<string[]> {
  try {
    return extractModelIds(await res.json(), provider);
  } catch {
    return [];
  }
}

/**
 * A dated snapshot of `id`, which some providers list instead of (or beside)
 * the alias: `claude-haiku-4-5-20251001` for `claude-haiku-4-5`. Only a date
 * or a three-digit revision counts -- a bare prefix match would let
 * "gemini-3.8-flash" pick "gemini-3.8-flash-lite", a different model.
 */
function datedVariant(id: string, available: readonly string[]): string | undefined {
  const re = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d{8}|\\d{4}-\\d{2}-\\d{2}|\\d{3})$`);
  return available.filter((a) => re.test(a)).sort().at(-1);
}

/** The id `available` lists for `id` -- itself, or a dated snapshot of it. */
export function findOn(id: string, available: readonly string[]): string | undefined {
  return available.includes(id) ? id : datedVariant(id, available);
}

/**
 * The model a key should ask.
 *
 * 1. `preferred` (the user's own pick, or what the key used last) when the
 *    provider still offers it.
 * 2. Otherwise the first of this app's choices the provider still offers.
 * 3. An empty `available` is "couldn't read the list": trust `preferred`, or
 *    the first choice.
 *
 * Null means the list was readable and has none of them -- the one case where
 * the app genuinely needs updating, reported as `model_missing`.
 */
export function chooseModel(
  provider: AIProviderName,
  available: readonly string[],
  preferred?: string | null,
): string | null {
  const choices = PROVIDER_MODEL_CHOICES[provider];
  if (available.length === 0) return preferred ?? choices[0];
  if (preferred) {
    const hit = findOn(preferred, available);
    if (hit) return hit;
  }
  for (const choice of choices) {
    const hit = findOn(choice, available);
    if (hit) return hit;
  }
  return null;
}

// Ids that are listed by /models but cannot answer a chat request. OpenAI's
// list in particular mixes in embeddings, speech, image and moderation models,
// and offering those in the model picker would only produce failed questions.
const NOT_CHAT =
  /embed|whisper|tts|transcri|dall-?e|image|audio|realtime|moderation|rerank|guard|safety|search-preview|computer-use|codex|sora|babbage|davinci|^omni-|speech|vision-only/i;

/**
 * The live list, trimmed to what makes sense in a model picker: chat-capable
 * ids only, this app's choices first (in order), the rest alphabetically.
 * OpenRouter keeps only `:free` variants -- a paid id there bills the user's
 * credit, which is a surprise nobody picking from a list expects.
 */
export function pickerModels(provider: AIProviderName, available: readonly string[]): string[] {
  const choices = PROVIDER_MODEL_CHOICES[provider];
  let chat = available.filter((id) => !NOT_CHAT.test(id));
  if (provider === "openrouter") chat = chat.filter((id) => id.endsWith(":free"));
  const recommended = choices.map((c) => findOn(c, chat)).filter((id): id is string => !!id);
  const rest = chat.filter((id) => !recommended.includes(id)).sort((a, b) => a.localeCompare(b));
  return [...new Set([...recommended, ...rest])];
}
