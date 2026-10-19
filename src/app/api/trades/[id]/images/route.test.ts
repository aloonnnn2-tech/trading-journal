import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { MAX_IMAGE_BYTES_PER_USER, MAX_IMAGES_PER_USER, ROW_LIMIT_MESSAGE } from "@/lib/limits";

// Security gaps pass, 5.1: the per-account screenshot quotas, the stored
// size, and a clear answer at the row cap.

const getUserIdFromHeader = vi.fn();
const enforceRateLimit = vi.fn();
const enforceDailyCap = vi.fn();
const getImageUsage = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const insertResults: { data: unknown; error: unknown }[] = [];
const inserted: Record<string, unknown>[] = [];

const rlsClient = {
  from: (table: string) => {
    expect(table).toBe("trade_images");
    return {
      insert: (values: Record<string, unknown>) => {
        inserted.push(values);
        return { select: () => ({ single: async () => insertResults.shift() }) };
      },
    };
  },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed" } }) }) },
};

vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: () => getUserIdFromHeader() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => rlsClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => ({ upload, remove }) } }),
}));
vi.mock("@/lib/trades/queries", () => ({ getTrade: async () => ({ id: "trade-1" }) }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a) }));
vi.mock("@/lib/rate-limits/daily", () => ({ enforceDailyCap: (...a: unknown[]) => enforceDailyCap(...a) }));
vi.mock("@/lib/images/quota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/images/quota")>()),
  getImageUsage: (...a: unknown[]) => getImageUsage(...a),
}));

const { POST } = await import("./route");

const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#123456" } }).png().toBuffer();

function post() {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(png)], "chart.png", { type: "image/png" }));
  return POST(new Request("https://x/api/trades/trade-1/images", { method: "POST", body: form }), {
    params: Promise.resolve({ id: "trade-1" }),
  });
}

const ROW = { id: "img-1", trade_id: "trade-1", storage_path: "p", created_at: "2026-10-18T00:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  insertResults.length = 0;
  inserted.length = 0;
  getUserIdFromHeader.mockResolvedValue("user-1");
  enforceRateLimit.mockResolvedValue(null);
  enforceDailyCap.mockResolvedValue(null);
  getImageUsage.mockResolvedValue({ files: 15, bytes: 400_000 });
  upload.mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: null });
});

describe("POST /api/trades/[id]/images quotas", () => {
  it("stores the file and records its size", async () => {
    insertResults.push({ data: ROW, error: null });
    const res = await post();
    expect(res.status).toBe(201);
    expect(upload).toHaveBeenCalledTimes(1);
    const stored = upload.mock.calls[0][1] as Buffer;
    expect(inserted[0]).toMatchObject({ trade_id: "trade-1", user_id: "user-1", size_bytes: stored.length });
    expect(enforceDailyCap).toHaveBeenCalledWith("image-upload", "user-1");
  });

  it("refuses at the file-count quota before anything is stored or counted", async () => {
    getImageUsage.mockResolvedValue({ files: MAX_IMAGES_PER_USER, bytes: 0 });
    const res = await post();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/limit of 2,000 screenshots/);
    expect(upload).not.toHaveBeenCalled();
    expect(enforceDailyCap).not.toHaveBeenCalled();
  });

  it("refuses at the byte quota", async () => {
    getImageUsage.mockResolvedValue({ files: 10, bytes: MAX_IMAGE_BYTES_PER_USER });
    const res = await post();
    expect(res.status).toBe(429);
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns the daily cap's 429 when today's uploads are used up", async () => {
    enforceDailyCap.mockResolvedValue(new Response(JSON.stringify({ error: "daily" }), { status: 429 }));
    const res = await post();
    expect(res.status).toBe(429);
    expect(upload).not.toHaveBeenCalled();
  });

  it("fails open when usage can't be read: the upload still works", async () => {
    getImageUsage.mockRejectedValue(new Error("db down"));
    insertResults.push({ data: ROW, error: null });
    expect((await post()).status).toBe(201);
  });

  it("before 0074, saves the row without size_bytes", async () => {
    insertResults.push({ data: null, error: { code: "PGRST204", message: "no size_bytes column" } });
    insertResults.push({ data: ROW, error: null });
    expect((await post()).status).toBe(201);
    expect(inserted).toHaveLength(2);
    expect(inserted[1]).not.toHaveProperty("size_bytes");
  });

  it("at the row cap, removes the stored file and says so", async () => {
    insertResults.push({ data: null, error: { code: "54000", message: "Row limit reached" } });
    const res = await post();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: ROW_LIMIT_MESSAGE });
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
  });
});
