import { beforeEach, describe, expect, it, vi } from "vitest";

// PATCH /api/admin/reviews/[id]: admins only, and a clear answer when a
// review may not go on the homepage.

const ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";
const getUserIdFromHeader = vi.fn();
const isAdmin = vi.fn();
const setReviewFeatured = vi.fn();

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/lib/tracking/admin-queries", () => ({ isAdmin: (...a: unknown[]) => isAdmin(...a) }));
vi.mock("@/lib/reviews/queries", () => ({ setReviewFeatured: (...a: unknown[]) => setReviewFeatured(...a) }));

const { PATCH } = await import("./route");
const patch = (body: unknown, id = ID) =>
  PATCH(new Request(`http://x/api/admin/reviews/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  getUserIdFromHeader.mockResolvedValue("admin");
  isAdmin.mockResolvedValue(true);
  setReviewFeatured.mockResolvedValue(undefined);
});

describe("PATCH /api/admin/reviews/[id]", () => {
  it("403 for a non-admin, before touching anything", async () => {
    isAdmin.mockResolvedValue(false);
    expect((await patch({ featured: true })).status).toBe(403);
    expect(setReviewFeatured).not.toHaveBeenCalled();
  });

  it("features a review", async () => {
    expect((await patch({ featured: true })).status).toBe(200);
    expect(setReviewFeatured).toHaveBeenCalledWith(expect.anything(), ID, true);
  });

  it("says why a review can't go on the homepage", async () => {
    setReviewFeatured.mockRejectedValue({ code: "23514" });
    const res = await patch({ featured: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/4–5 star/);
  });

  it("refuses a bad id or body", async () => {
    expect((await patch({ featured: true }, "nope")).status).toBe(404);
    expect((await patch({ featured: "yes" })).status).toBe(400);
  });
});
