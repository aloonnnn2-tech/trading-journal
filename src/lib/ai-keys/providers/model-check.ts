import type { AIProviderName } from "../types";
import { ProviderError } from "./types";

// Confirms the model this app asks for still exists at the provider.
//
// This runs during key validation, reusing the /models response that was
// already fetched to test the credentials -- so it costs no extra request and
// no tokens. The point is *when* the failure surfaces: a retired model id
// otherwise stays invisible until someone asks a question, and shows up as a
// vague provider error with no hint that the key is fine and the app's
// configuration is what's stale.
//
// Every provider here retires models on its own schedule, and nothing in a
// build or test run would catch it. This check is the only thing standing
// between that and a confusing bug report.

/** Pulls the model ids out of each provider's /models response shape. */
function extractModelIds(body: unknown, provider: AIProviderName): string[] {
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

  const data = Array.isArray(json?.data) ? json.data : [];
  return data
    .map((m) => (m as { id?: unknown }).id)
    .filter((id): id is string => typeof id === "string");
}

export async function assertModelAvailable(
  res: Response,
  model: string,
  provider: AIProviderName,
): Promise<void> {
  let ids: string[];
  try {
    ids = extractModelIds(await res.json(), provider);
  } catch {
    // Unreadable or unexpected response shape. Not a reason to reject a key
    // that just authenticated successfully -- fail open and let any real
    // problem surface at question time, where it is still reported clearly.
    return;
  }

  // An empty list means the shape wasn't what we expected, not that the
  // provider has no models. Failing open is right for the same reason.
  if (ids.length === 0) return;

  if (!ids.includes(model)) {
    throw new ProviderError(
      "model_missing",
      `configured model "${model}" is not in ${provider}'s list of ${ids.length} available models`,
    );
  }
}
