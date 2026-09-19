import { describe, expect, it, vi, beforeEach } from "vitest";

// Every dependency is mocked at the boundary: this test is about the route's
// decision table (which state each provider outcome maps to, and whether a
// rejected key gets parked), not about crypto, RLS or real HTTP.

const validateKey = vi.fn();
const markApiKeyInvalid = vi.fn();
const getDecryptedKey = vi.fn();
const rateLimit = vi.fn();
const requirePaidUser = vi.fn();

class ProviderError extends Error {
  constructor(
    public failure: string,
    public detail: string,
  ) {
    super(detail);
  }
}

vi.mock("@/lib/ai-keys/guard", () => ({ requirePaidUser: () => requirePaidUser() }));
vi.mock("@/lib/ai-keys/queries", () => ({
  getDecryptedKey: (...a: unknown[]) => getDecryptedKey(...a),
  markApiKeyInvalid: (...a: unknown[]) => markApiKeyInvalid(...a),
}));
vi.mock("@/lib/ai-keys/providers", () => ({
  getProvider: () => ({ validateKey: (k: string) => validateKey(k) }),
  providerModel: (p: string) => `model-for-${p}`,
  ProviderError,
}));
vi.mock("@/lib/ai-keys/crypto", () => ({ isEncryptionConfigured: () => true }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }));

const { POST } = await import("./route");

function call(id = "key-1") {
  return POST(new Request("https://tradinglenz.netlify.app/api/ai-keys/key-1/test", { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePaidUser.mockResolvedValue({ ok: true, supabase: {}, userId: "user-1" });
  rateLimit.mockResolvedValue({ ok: true });
  getDecryptedKey.mockResolvedValue({ provider: "groq", key: "gsk_secret" });
});

describe("POST /api/ai-keys/[id]/test", () => {
  it("reports a working key without parking it", async () => {
    validateKey.mockResolvedValue(true);

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.state).toBe("working");
    expect(markApiKeyInvalid).not.toHaveBeenCalled();
  });

  it("parks a key the provider rejects", async () => {
    validateKey.mockResolvedValue(false);

    const body = await (await call()).json();

    expect(body.ok).toBe(false);
    expect(body.state).toBe("rejected");
    // The whole point of the route: a key that just failed an explicit check
    // must not stay listed as usable.
    expect(markApiKeyInvalid).toHaveBeenCalledWith({}, "key-1");
  });

  it("separates a retired model from a bad key, and does NOT park it", async () => {
    validateKey.mockRejectedValue(new ProviderError("model_missing", "no such model"));

    const body = await (await call()).json();

    expect(body.state).toBe("model_missing");
    // The user's key is fine here; switching it off would send them to
    // replace a key that was never the problem.
    expect(markApiKeyInvalid).not.toHaveBeenCalled();
  });

  it("treats an unreachable provider as inconclusive, not as a bad key", async () => {
    validateKey.mockRejectedValue(new ProviderError("failed", "socket hang up"));

    const body = await (await call()).json();

    expect(body.state).toBe("unreachable");
    expect(markApiKeyInvalid).not.toHaveBeenCalled();
  });

  it("never echoes the decrypted key or the provider's raw error", async () => {
    validateKey.mockRejectedValue(new ProviderError("failed", "bad key gsk_secret rejected"));

    const text = await (await call()).text();

    expect(text).not.toContain("gsk_secret");
    expect(text).not.toContain("bad key");
  });

  it("reads parked keys too -- the case the button exists for", async () => {
    validateKey.mockResolvedValue(true);

    await call();

    // Without includeInactive, getDecryptedKey filters to is_active = true and
    // a parked key 404s -- which would make Test useless on exactly the rows
    // that need it. The ask path must keep the restrictive default.
    expect(getDecryptedKey).toHaveBeenCalledWith({}, "key-1", "user-1", { includeInactive: true });
  });

  it("404s an id that doesn't resolve, rather than confirming it exists", async () => {
    getDecryptedKey.mockResolvedValue(null);

    const res = await call("someone-elses-key");

    expect(res.status).toBe(404);
    expect(validateKey).not.toHaveBeenCalled();
  });

  it("refuses when the caller isn't on a paid plan", async () => {
    requirePaidUser.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 402 }),
    });

    const res = await call();

    expect(res.status).toBe(402);
    expect(getDecryptedKey).not.toHaveBeenCalled();
  });

  it("rate limits before making any outbound provider call", async () => {
    rateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 30 });

    const res = await call();

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(validateKey).not.toHaveBeenCalled();
  });
});
