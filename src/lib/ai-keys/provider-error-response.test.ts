import { describe, expect, it, vi } from "vitest";

vi.mock("./queries", () => ({ markApiKeyInvalid: vi.fn() }));

const { providerErrorResponse } = await import("./provider-error-response");
const { ProviderError } = await import("./providers");

const ctx = {
  supabase: {} as never,
  provider: "groq" as const,
  keyId: "key-1",
  logPrefix: "test",
  truncatedHint: "too long",
};

describe("providerErrorResponse — rate limits", () => {
  it("quotes the provider's own Retry-After instead of guessing", async () => {
    const res = await providerErrorResponse(
      new ProviderError("unavailable", "429 slow down", 42),
      ctx,
    );
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toContain("about 42 seconds");
    // Also surfaced as a real header, so a client can back off properly.
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it("falls back to vague wording only when the provider said nothing", async () => {
    const res = await providerErrorResponse(new ProviderError("unavailable", "429"), ctx);
    const body = await res.json();

    expect(body.error).toContain("Try again in a moment");
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("appends the caller's hint, so the user has something to change", async () => {
    const res = await providerErrorResponse(new ProviderError("unavailable", "429"), {
      ...ctx,
      hint: "Starting a new conversation asks for less at once.",
    });
    const body = await res.json();

    expect(body.error).toContain("Starting a new conversation");
  });

  it("never leaks the provider's raw error text to the client", async () => {
    const res = await providerErrorResponse(
      new ProviderError("unavailable", "429: your prompt began 'my AAPL trade on 3 Jan'"),
      ctx,
    );

    expect(await res.text()).not.toContain("AAPL");
  });

  it("singularises one second", async () => {
    const res = await providerErrorResponse(new ProviderError("unavailable", "429", 1), ctx);
    expect((await res.json()).error).toContain("about 1 second.");
  });
});
