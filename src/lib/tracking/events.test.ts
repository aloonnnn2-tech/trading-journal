import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLICK_LABELS,
  CLIENT_EVENTS,
  SERVER_EVENTS,
  clickName,
  describeEvent,
  pageName,
  validateClientEvent,
} from "./events";

// One sample of every event type, in the shape it is stored. The feed must
// turn each into a sentence -- never blank, never "Unknown".
const SAMPLES: Record<string, Record<string, unknown>> = {
  session_start: {},
  page_view: { path: "/trades" },
  page_exit: { path: "/strategies" },
  click: { label: "dashboard-quick-trade", tag: "button", path: "/trades" },
  login: {},
  signup_completed: {},
  tour_completed: { tour: "basics", steps: 9 },
  tour_skipped: { tour: "basics", atStep: 2 },
  dashboard_viewed: {},
  analytics_panel_viewed: {},
  settings_viewed: {},
  commissions_viewed: {},
  trade_created: { tradeId: "t1" },
  trade_edited: { tradeId: "t1" },
  trade_deleted: { tradeId: "t1" },
  import_used: { imported: 12, errors: 1 },
  export_used: { format: "csv" },
  ai_review_generated: { kind: "period", tradesAnalyzed: 24 },
  ai_question_answered: { provider: "groq", mode: "chat" },
  ai_key_added: { provider: "openai" },
  screenshot_parsed: {},
  account_transaction_added: { transactionId: "x" },
  account_transaction_deleted: { transactionId: "x" },
  commissions_recalculated: { updated: 3, skipped: 0, failed: 0 },
};

describe("every event type renders as a sentence", () => {
  const all = [...Object.keys(CLIENT_EVENTS), ...Object.keys(SERVER_EVENTS)];

  it("has a sample here for every event in the list (add one when adding an event)", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...all].sort());
  });

  it.each(all)("%s", (name) => {
    const d = describeEvent(name, SAMPLES[name]);
    expect(d.sentence.trim().length).toBeGreaterThan(3);
    expect(d.sentence).not.toMatch(/Unknown event/);
    expect(d.unmapped).toBe(false);
    expect(d.category).not.toBe("unknown");
  });

  it("an event stored with NO props is still a sentence (the old blank rows)", () => {
    for (const name of ["session_start", "dashboard_viewed", "login", "signup_completed", "screenshot_parsed"]) {
      expect(describeEvent(name, {}).sentence.length).toBeGreaterThan(3);
    }
  });
});

describe("the rows from Alon's screenshot", () => {
  it.each([
    ["click", { tag: "button", path: "/trades", label: "dashboard-quick-trade" }, "Clicked **Quick trade** on **Trades**"],
    ["click", { tag: "button", path: "/trades", label: "Close (Esc)" }, "Closed the **trade panel** on **Trades**"],
    ["click", { tag: "a", path: "/dashboard", label: "nav-strategies" }, "Opened **Strategies** from the menu on **Dashboard**"],
    ["click", { tag: "a", path: "/dashboard", label: "nav-trades" }, "Opened **Trades** from the menu on **Dashboard**"],
    ["click", { tag: "button", path: "/dashboard", label: "nav-group-ai" }, "Expanded the **AI** menu on **Dashboard**"],
    ["click", { tag: "button", path: "/dashboard", label: "nav-group-setup" }, "Expanded the **Setup** menu on **Dashboard**"],
    ["page_view", { path: "/trades" }, "Opened **Trades**"],
    ["page_view", { path: "/strategies" }, "Opened **Strategies**"],
    ["tour_skipped", { tour: "basics", atStep: 2 }, "Left the **Basics** tour at step 2"],
  ] as const)("%s %j", (name, props, sentence) => {
    expect(describeEvent(name, props as Record<string, unknown>).sentence).toBe(sentence);
  });
});

describe("never blank, never silent", () => {
  it("an unknown event shows its raw data and is flagged", () => {
    const d = describeEvent("something_new", { a: 1 });
    expect(d.sentence).toMatch(/^Unknown event \(raw: .*something_new/);
    expect(d.unmapped).toBe(true);
  });

  it("a developer id with no name is flagged; words and empty labels are not", () => {
    expect(clickName("mystery-button").mapped).toBe(false);
    expect(clickName("Save fee")).toEqual({ sentence: 'Clicked **"Save fee"**', mapped: true });
    expect(clickName(null).sentence).toMatch(/unlabelled/);
  });

  it("names pages, including ones with ids in the path", () => {
    expect(pageName("/insights")).toBe("Insights");
    expect(pageName("/trades/3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b")).toBe("a trade");
    expect(pageName("/trades?folder=x")).toBe("Trades");
    expect(pageName(undefined)).toBe("an unknown page");
  });
});

describe("the server accepts only listed browser events", () => {
  it("accepts a valid click and page_exit", () => {
    expect(validateClientEvent("click", { label: "x", tag: "a", path: "/trades" }).ok).toBe(true);
    expect(validateClientEvent("click", { label: null, tag: "a", path: "/trades" }).ok).toBe(true);
    expect(validateClientEvent("page_exit", { path: "/trades" }).ok).toBe(true);
  });

  it("refuses unknown names, server-only names, extra props and bad paths", () => {
    expect(validateClientEvent("made_up", {})).toEqual({ ok: false, reason: "unknown_event" });
    // A browser must not be able to forge a server event.
    expect(validateClientEvent("trade_created", { tradeId: "x" })).toEqual({ ok: false, reason: "unknown_event" });
    expect(validateClientEvent("page_view", { path: "/trades", note: "typed text" })).toEqual({
      ok: false,
      reason: "bad_props",
    });
    expect(validateClientEvent("page_view", { path: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateClientEvent("tour_skipped", { tour: "other", atStep: 1 }).ok).toBe(false);
  });
});

// ---- Prevention: every id the UI can emit has a readable name.

const SRC = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

describe("click label coverage", () => {
  it("every literal data-tour-id and data-track in the source has a name in CLICK_LABELS", () => {
    const missing = new Set<string>();
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      const re = /data-(?:tour-id|track)=(?:\{\s*)?(?:[^"'`{}]*\?\s*)?["']([^"'`${}]+)["']/g;
      for (const m of text.matchAll(re)) {
        if (!CLICK_LABELS[m[1]]) missing.add(`${m[1]}  (${path.relative(SRC, file)})`);
      }
    }
    expect([...missing], "add these to CLICK_LABELS in src/lib/tracking/events.ts").toEqual([]);
  });

  it("the scan itself finds the ids it should (guards a broken regex)", () => {
    const text = fs.readFileSync(path.join(SRC, "app/trades/new-trade-button.tsx"), "utf8");
    expect(text).toContain('data-tour-id="dashboard-quick-trade"');
    expect(CLICK_LABELS["dashboard-quick-trade"]).toBeDefined();
  });
});
