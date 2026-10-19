// Shaping a provider's live model list for the model picker in Ask.
//
// A provider's /models list includes things that can't hold a conversation
// at all -- embeddings, speech, image generation, moderation. Picking one of
// those breaks Ask with an error the user can't make sense of, so the picker
// leaves them out. Hints are only given where the name says it plainly:
// nothing here claims a model is "best", only bigger or smaller.

const NOT_CHAT = /(embed|whisper|tts|transcri|speech|audio|dall-?e|image|imagen|vision-preview|moderation|guard|rerank|realtime|search-preview|computer-use|sora|veo|lyria)/i;

/** The models from a provider's live list that can answer a chat, in the provider's order. */
export function chatModels(models: readonly string[]): string[] {
  return [...new Set(models)].filter((m) => !NOT_CHAT.test(m));
}

// Whole name parts only: "gemini" contains "mini", and Gemini Pro is not small.
const SMALL = /(?:^|[-_./:])(?:mini|nano|lite|small|haiku|flash|instant|(?:1|3|7|8|9|12|14|20|24|26|27)b)(?=$|[-_./:])/i;
const LARGE = /(?:^|[-_./:])(?:opus|ultra|pro|large|405b|235b|120b|70b|72b)(?=$|[-_./:])/i;

/** "smaller, faster" / "larger, more capable" where the name says so; else null. */
export function modelHint(model: string): string | null {
  if (SMALL.test(model)) return "smaller, faster";
  if (LARGE.test(model)) return "larger, more capable";
  return null;
}
