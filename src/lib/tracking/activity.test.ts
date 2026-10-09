import { describe, expect, it } from "vitest";
import { buildActivity, filterFeed, IDLE_END_MS, type ActivityRow } from "./activity";

const NOW = new Date("2026-10-09T12:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function row(over: Partial<ActivityRow> & Pick<ActivityRow, "eventName">): ActivityRow {
  return {
    createdAt: ago(0),
    userId: "u1",
    email: "a@x.com",
    excluded: false,
    sessionId: "s1",
    props: {},
    ...over,
  };
}

describe("buildActivity: sessions and where they left", () => {
  it("a session whose last event is page_exit ended there (sent)", () => {
    const a = buildActivity(
      [
        row({ eventName: "session_start", createdAt: ago(10) }),
        row({ eventName: "page_view", props: { path: "/dashboard" }, createdAt: ago(10) }),
        row({ eventName: "page_view", props: { path: "/trades" }, createdAt: ago(8) }),
        row({ eventName: "page_view", props: { path: "/trades" }, createdAt: ago(7) }),
        row({ eventName: "page_exit", props: { path: "/trades" }, createdAt: ago(5) }),
      ],
      NOW,
    );
    expect(a.sessions).toHaveLength(1);
    expect(a.sessions[0].pages).toEqual(["Dashboard", "Trades"]);
    expect(a.sessions[0].exit).toEqual({ kind: "sent", page: "Trades" });
    expect(a.sessions[0].durationSeconds).toBe(300);
  });

  it("no exit and quiet for 30 minutes: the last page, marked inferred", () => {
    const a = buildActivity(
      [
        row({ eventName: "page_view", props: { path: "/strategies" }, createdAt: ago(45) }),
        row({ eventName: "click", props: { label: "strategies-add", tag: "button", path: "/strategies" }, createdAt: ago(44) }),
      ],
      NOW,
    );
    expect(a.sessions[0].exit).toEqual({ kind: "inferred", page: "Strategies" });
  });

  it("recent activity with no exit is still active, and not counted as an exit", () => {
    const a = buildActivity([row({ eventName: "page_view", props: { path: "/ask" }, createdAt: ago(5) })], NOW);
    expect(a.sessions[0].exit.kind).toBe("active");
    expect(a.exits).toEqual([]);
  });

  it("coming back after an exit means the exit wasn't the end", () => {
    const a = buildActivity(
      [
        row({ eventName: "page_exit", props: { path: "/trades" }, createdAt: ago(50) }),
        row({ eventName: "page_view", props: { path: "/goals" }, createdAt: ago(40) }),
      ],
      NOW,
    );
    expect(a.sessions[0].exit).toEqual({ kind: "inferred", page: "Goals" });
  });

  it("where users leave: counts and shares across finished sessions", () => {
    const rows = [
      row({ sessionId: "a", eventName: "page_exit", props: { path: "/trades" }, createdAt: ago(60) }),
      row({ sessionId: "b", eventName: "page_exit", props: { path: "/trades" }, createdAt: ago(60) }),
      row({ sessionId: "c", eventName: "page_view", props: { path: "/insights" }, createdAt: ago(90) }),
      row({ sessionId: "d", eventName: "page_view", props: { path: "/ask" }, createdAt: ago(1) }),
    ];
    const a = buildActivity(rows, NOW);
    expect(a.exits).toEqual([
      { page: "Trades", count: 2, inferred: 0, share: 2 / 3 },
      { page: "Insights", count: 1, inferred: 1, share: 1 / 3 },
    ]);
  });

  it("server-side events never form a session", () => {
    const a = buildActivity([row({ sessionId: "server", eventName: "trade_created", props: { tradeId: "t" } })], NOW);
    expect(a.sessions).toEqual([]);
    expect(a.feed[0].sentence).toBe("Created **a trade**");
  });

  it("the idle threshold is 30 minutes", () => {
    expect(IDLE_END_MS).toBe(30 * 60_000);
  });
});

describe("buildActivity: feed and clicks", () => {
  it("feed is newest first, every row a sentence, unknown rows counted", () => {
    const a = buildActivity(
      [
        row({ eventName: "login", createdAt: ago(3) }),
        row({ eventName: "weird_thing", props: { x: 1 }, createdAt: ago(2) }),
        row({ eventName: "click", props: { label: "nobody-knows-me", tag: "button", path: "/trades" }, createdAt: ago(1) }),
      ],
      NOW,
    );
    expect(a.feed.map((f) => f.sentence)).toEqual([
      "Clicked an unnamed control (raw: nobody-knows-me) on **Trades**",
      'Unknown event (raw: {"event":"weird_thing","x":1})',
      "Signed in",
    ]);
    expect(a.feed.every((f) => f.sentence.trim() !== "")).toBe(true);
    expect(a.unmappedCount).toBe(2);
  });

  it("most clicked groups by label and shows the readable name", () => {
    const click = (label: string) => row({ eventName: "click", props: { label, tag: "a", path: "/dashboard" } });
    const a = buildActivity([click("nav-strategies"), click("nav-strategies"), click("Close (Esc)")], NOW);
    expect(a.clicks[0]).toMatchObject({ name: "Opened **Strategies** from the menu", raw: "nav-strategies", count: 2, mapped: true });
    expect(a.clicks[1]).toMatchObject({ name: "Closed the **trade panel**", count: 1 });
  });

  it("filterFeed keeps a category", () => {
    const a = buildActivity(
      [row({ eventName: "login" }), row({ eventName: "page_view", props: { path: "/trades" } })],
      NOW,
    );
    expect(filterFeed(a.feed, "navigation").map((f) => f.sentence)).toEqual(["Opened **Trades**"]);
    expect(filterFeed(a.feed, null)).toHaveLength(2);
  });
});
