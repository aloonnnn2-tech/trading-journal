import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROW_LIMIT_MESSAGE } from "@/lib/limits";

// Security gaps pass, 5.2: a database row cap (0067) reads as "limit
// reached", not a bare 500. Folders stands in for every create route that
// uses rowLimitResponse.

const createFolder = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: async () => "user-1" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/folders/queries", () => ({
  createFolder: (...a: unknown[]) => createFolder(...a),
  listFolders: async () => [],
}));

const { POST } = await import("./route");
const post = () => POST(new Request("https://x/api/folders", { method: "POST", body: JSON.stringify({ name: "Swing" }) }));

beforeEach(() => vi.clearAllMocks());

describe("POST /api/folders at the row cap", () => {
  it("answers 429 with the limit message", async () => {
    createFolder.mockRejectedValue({ code: "54000", message: "Row limit reached: folders allows at most 1000 rows per account." });
    const res = await post();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: ROW_LIMIT_MESSAGE });
  });

  it("still creates normally, and still throws other errors", async () => {
    createFolder.mockResolvedValueOnce({ id: "f1", name: "Swing" });
    expect((await post()).status).toBe(201);
    createFolder.mockRejectedValueOnce({ code: "XX000", message: "boom" });
    await expect(post()).rejects.toMatchObject({ code: "XX000" });
  });
});
