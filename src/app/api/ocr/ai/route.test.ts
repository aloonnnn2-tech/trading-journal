import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// POST /api/ocr/ai with every boundary mocked except the reading itself:
// the real generateStructured, schema and mapping run against a fake
// provider that "sees" the image.

const gate = vi.fn();
const preflight = vi.fn();
const askQuestion = vi.fn();

vi.mock("@/lib/ai-keys/guard", () => ({ requirePaidUser: () => gate() }));
vi.mock("@/lib/ai-keys/preflight", () => ({ preflightProviderCall: (...a: unknown[]) => preflight(...a) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true, retryAfterSeconds: 0 }) }));
vi.mock("@/lib/rate-limits/daily", () => ({ enforceDailyCap: async () => null }));
vi.mock("@/lib/ocr/duplicates", () => ({
  findPossibleDuplicates: async () => [],
  accuracyLogLine: () => ({}),
}));
vi.mock("@/lib/ai-keys/providers", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai-keys/providers")>()),
  getProvider: () => ({ name: "openai", model: "m", askQuestion: (...a: unknown[]) => askQuestion(...a) }),
}));

const { POST } = await import("./route");

const KEY = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";
const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#fff" } }).png().toBuffer();

function call(file: Blob | null, keyId: string = KEY) {
  const form = new FormData();
  if (file) form.set("file", new File([file], "shot.png", { type: "image/png" }));
  form.set("keyId", keyId);
  return POST(new Request("http://x/api/ocr/ai", { method: "POST", body: form }));
}

const goodReply = JSON.stringify({
  broker_detected: "Webull",
  rows: [
    {
      symbol: { value: "NVDA", confidence: 0.95, source_text: "NVDA" },
      side: { value: "buy", confidence: 0.95, source_text: "Buy" },
      quantity: { value: 5, confidence: 0.95, source_text: "5" },
      price: { value: 120.5, confidence: 0.95, source_text: "120.50" },
      status: { value: "filled", confidence: 0.9, source_text: "Filled" },
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  gate.mockResolvedValue({ ok: true, userId: "u1", supabase: {} });
  preflight.mockResolvedValue({ ok: true, provider: "openai", key: "secret", model: "gpt-5-mini" });
  askQuestion.mockResolvedValue(goodReply);
});

describe("POST /api/ocr/ai", () => {
  it("refuses a free account (the paid gate's own answer)", async () => {
    gate.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Upgrade" }, { status: 403 }) });
    expect((await call(new Blob([png]))).status).toBe(403);
    expect(askQuestion).not.toHaveBeenCalled();
  });

  it("asks for the screenshot agreement before anything is sent", async () => {
    preflight.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "agree first", needsConsent: "openai" }, { status: 403 }),
    });
    const res = await call(new Blob([png]));
    expect(res.status).toBe(403);
    expect((await res.json()).needsConsent).toBe("openai");
    expect(preflight.mock.calls[0][3]).toBe("screenshot_v1");
    expect(askQuestion).not.toHaveBeenCalled();
  });

  it("refuses a provider whose models can't see images", async () => {
    preflight.mockResolvedValue({ ok: true, provider: "groq", key: "secret", model: "x" });
    const res = await call(new Blob([png]));
    expect(res.status).toBe(400);
    expect(askQuestion).not.toHaveBeenCalled();
  });

  it("refuses a file that isn't an image, and a bad key id", async () => {
    expect((await call(new Blob(["<svg></svg>"]))).status).toBe(400);
    expect((await call(new Blob([png]), "not-a-uuid")).status).toBe(400);
    expect(askQuestion).not.toHaveBeenCalled();
  });

  it("sends the re-encoded image once and returns the review screen's shape", async () => {
    const res = await call(new Blob([png]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.core.ticker.value).toBe("NVDA");
    expect(body.core.direction.value).toBe("long");
    expect(body.core.entry_price.value).toBe(120.5);
    expect(body.core.status.heuristic).toBe(true);
    expect(body.broker).toBe("Webull");

    const options = askQuestion.mock.calls[0][3] as { images: { mime: string; base64: string }[] };
    expect(options.images).toHaveLength(1);
    expect(options.images[0].mime).toBe("image/jpeg");
    const sent = await sharp(Buffer.from(options.images[0].base64, "base64")).metadata();
    expect(sent.format).toBe("jpeg");
  });

  it("an unreadable answer is a plain 502, never a guessed result", async () => {
    askQuestion.mockResolvedValue("I think it's probably AAPL, around 190?");
    const res = await call(new Blob([png]));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/nothing was filled in/);
    // The repair step resends the reply, never the image.
    const repair = askQuestion.mock.calls[1]?.[3] as { images?: unknown } | undefined;
    expect(repair?.images).toBeUndefined();
  });
});
