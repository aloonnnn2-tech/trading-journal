import { beforeEach, describe, expect, it, vi } from "vitest";

// PUT /api/reviews/mine: only the caller's own review, only valid input, and
// never from the shared demo account.

const USER = "11111111-1111-4111-8111-111111111111";
const getUserIdFromHeader = vi.fn();
const saveMyReview = vi.fn();
const getPromptState = vi.fn();
const logEvent = vi.fn();

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/lib/tracking/log", () => ({ logEvent: (...a: unknown[]) => logEvent(...a), SERVER_SESSION_ID: "server" }));
vi.mock("@/lib/reviews/queries", () => ({
  saveMyReview: (...a: unknown[]) => saveMyReview(...a),
  getPromptState: (...a: unknown[]) => getPromptState(...a),
  getMyReview: async () => null,
  deleteMyReview: async () => {},
  isMissingReviews: () => false,
}));

const { PUT } = await import("./route");
const put = (body: unknown) =>
  PUT(new Request("http://x/api/reviews/mine", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const good = { rating: 5, comment: "  Love it  ", allowPublic: true, displayName: " Dan K. ", source: "closed_trades" };

beforeEach(() => {
  vi.clearAllMocks();
  getUserIdFromHeader.mockResolvedValue(USER);
  getPromptState.mockResolvedValue({ excluded_from_analytics: false });
  saveMyReview.mockImplementation(async (_s, _u, input) => ({ ...input, featured: false, updatedAt: "now" }));
});

describe("PUT /api/reviews/mine", () => {
  it("401 signed out", async () => {
    getUserIdFromHeader.mockResolvedValue(null);
    expect((await put(good)).status).toBe(401);
    expect(saveMyReview).not.toHaveBeenCalled();
  });

  it("refuses bad input: no stars, 6 stars, too long, unknown fields", async () => {
    for (const body of [
      { ...good, rating: 0 },
      { ...good, rating: 6 },
      { ...good, comment: "x".repeat(1001) },
      { ...good, displayName: "x".repeat(41) },
      { ...good, featured: true },
      { ...good, userId: "someone-else" },
    ]) {
      expect((await put(body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect(saveMyReview).not.toHaveBeenCalled();
  });

  it("saves the caller's own review, trimmed, and logs it", async () => {
    const res = await put(good);
    expect(res.status).toBe(200);
    expect(saveMyReview).toHaveBeenCalledWith(expect.anything(), USER, {
      rating: 5,
      comment: "Love it",
      allowPublic: true,
      displayName: "Dan K.",
      source: "closed_trades",
    });
    expect(logEvent).toHaveBeenCalledWith(expect.anything(), USER, "server", "review_submitted", {
      rating: 5,
      allowPublic: true,
      source: "closed_trades",
    });
  });

  it("refuses the shared demo account", async () => {
    getPromptState.mockResolvedValue({ excluded_from_analytics: true });
    expect((await put(good)).status).toBe(403);
    expect(saveMyReview).not.toHaveBeenCalled();
  });
});
