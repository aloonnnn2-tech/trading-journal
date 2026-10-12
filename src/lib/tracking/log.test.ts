import { beforeEach, describe, expect, it, vi } from "vitest";

// Events go through the service-role client (0066 took insert away from
// users), and analytics stays best-effort: no failure may reach the caller.
const insert = vi.fn();
const from = vi.fn(() => ({ insert }));
const createAdminClient = vi.fn(() => ({ from }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }));

import { logEvent, logEvents } from "./log";

const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  insert.mockReset().mockResolvedValue({ error: null });
  from.mockClear();
  createAdminClient.mockClear();
});

describe("logEvent", () => {
  it("writes one row for the given user with the service-role client", async () => {
    await logEvent(USER, "sess-1", "trade_created", { tradeId: "t1" });
    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("analytics_events");
    expect(insert).toHaveBeenCalledWith({
      user_id: USER,
      session_id: "sess-1",
      event_name: "trade_created",
      event_props: { tradeId: "t1" },
    });
  });

  it("never throws: a missing service-role key or a failed insert is swallowed", async () => {
    createAdminClient.mockImplementationOnce(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    });
    await expect(logEvent(USER, "sess-1", "trade_created")).resolves.toBeUndefined();
    insert.mockRejectedValueOnce(new Error("network"));
    await expect(logEvent(USER, "sess-1", "trade_created")).resolves.toBeUndefined();
  });
});

describe("logEvents", () => {
  it("writes the whole batch in one insert, every row owned by the given user", async () => {
    await logEvents(USER, "sess-2", [
      { eventName: "trade_created", props: { tradeId: "a" } },
      { eventName: "trade_deleted" },
    ]);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith([
      { user_id: USER, session_id: "sess-2", event_name: "trade_created", event_props: { tradeId: "a" } },
      { user_id: USER, session_id: "sess-2", event_name: "trade_deleted", event_props: {} },
    ]);
  });

  it("does nothing for an empty batch", async () => {
    await logEvents(USER, "sess-2", []);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
