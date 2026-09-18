import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBatcher, deriveLabel, describeClick, findInteractive } from "./click-capture";

// The label rule is the privacy control for "every click" analytics, so it is
// pinned down here against fake elements: precedence, the length cap, and the
// two ways user content is kept out (data-track-private, and links into an
// individual trade). No DOM environment is installed, so elements are
// duck-typed -- deriveLabel only touches getAttribute/closest/id/tagName/
// textContent, which is exactly what these fakes provide.

interface FakeEl {
  tagName: string;
  id: string;
  textContent: string;
  attrs: Record<string, string>;
  parent: FakeEl | null;
  getAttribute: (n: string) => string | null;
  closest: (sel: string) => FakeEl | null;
}

function el(
  tagName: string,
  { id = "", text = "", attrs = {}, parent = null as FakeEl | null } = {},
): FakeEl {
  const node: FakeEl = {
    tagName: tagName.toUpperCase(),
    id,
    textContent: text,
    attrs,
    parent,
    getAttribute: (n) => (n in node.attrs ? node.attrs[n] : null),
    // Only the one selector deriveLabel uses; walks up through parents.
    closest: (sel) => {
      if (sel !== "[data-track-private]") return null;
      let cur: FakeEl | null = node;
      while (cur) {
        if ("data-track-private" in cur.attrs) return cur;
        cur = cur.parent;
      }
      return null;
    },
  };
  return node;
}

const asEl = (f: FakeEl) => f as unknown as Element;

describe("deriveLabel precedence", () => {
  it("prefers data-track over everything", () => {
    const b = el("button", { id: "save", text: "Save changes", attrs: { "data-track": "save-trade", "aria-label": "Save" } });
    expect(deriveLabel(asEl(b))).toBe("save-trade");
  });

  it("then aria-label, then id, then data-tour-id, then text", () => {
    expect(deriveLabel(asEl(el("button", { id: "x", text: "T", attrs: { "aria-label": "Close dialog" } })))).toBe("Close dialog");
    expect(deriveLabel(asEl(el("button", { id: "submit-btn", text: "Go" })))).toBe("#submit-btn");
    expect(deriveLabel(asEl(el("button", { text: "Go", attrs: { "data-tour-id": "ask-submit" } })))).toBe("ask-submit");
    expect(deriveLabel(asEl(el("button", { text: "Import trades" })))).toBe("Import trades");
  });

  it("collapses whitespace and caps text at 40 chars", () => {
    const long = "This   is a\n very long   button label that keeps on going forever";
    const out = deriveLabel(asEl(el("button", { text: long })))!;
    expect(out.length).toBe(40);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s{2,}/);
  });

  it("returns null for an element with no usable source", () => {
    expect(deriveLabel(asEl(el("button", { text: "   " })))).toBeNull();
  });

  it("falls back to title for icon-only buttons, below the privacy guards", () => {
    // The theme toggle: no text, no aria-label, names itself with title.
    expect(deriveLabel(asEl(el("button", { attrs: { title: "Toggle theme" } })))).toBe("Toggle theme");
    // But a title inside a private region is suppressed like text would be.
    const region = el("div", { attrs: { "data-track-private": "" } });
    expect(deriveLabel(asEl(el("button", { attrs: { title: "My Folder" }, parent: region })))).toBeNull();
  });
});

describe("deriveLabel privacy rules", () => {
  it("suppresses text anywhere under data-track-private", () => {
    const region = el("div", { attrs: { "data-track-private": "" } });
    const link = el("a", { text: "My Secret Strategy", parent: region });
    expect(deriveLabel(asEl(link))).toBeNull();
  });

  it("still honours an explicit data-track inside a private region", () => {
    // Developer-authored, so it cannot carry user content -- allowed through.
    const region = el("div", { attrs: { "data-track-private": "" } });
    const link = el("a", { text: "AAPL", attrs: { "data-track": "trade row" }, parent: region });
    expect(deriveLabel(asEl(link))).toBe("trade row");
  });

  it("labels a link into an individual trade generically, never by its text", () => {
    const link = el("a", {
      text: "AAPL",
      attrs: { href: "/trades/ac7a50d3-5119-469a-8113-f276468b9e52" },
    });
    expect(deriveLabel(asEl(link))).toBe("trade link");
  });

  it("does not treat static /trades routes as trade links", () => {
    expect(deriveLabel(asEl(el("a", { text: "Import", attrs: { href: "/trades/import" } })))).toBe("Import");
    expect(deriveLabel(asEl(el("a", { text: "Trades", attrs: { href: "/trades" } })))).toBe("Trades");
  });
});

describe("describeClick", () => {
  it("produces the event shape with a lowercased tag and optional role", () => {
    const b = el("BUTTON", { text: "Ask", attrs: { role: "tab" } });
    expect(describeClick(asEl(b), "/ask")).toEqual({
      eventName: "click",
      props: { label: "Ask", tag: "button", path: "/ask", role: "tab" },
    });
  });

  it("omits role when absent", () => {
    const b = el("a", { text: "Home", attrs: { href: "/" } });
    expect(describeClick(asEl(b), "/x").props).not.toHaveProperty("role");
  });
});

describe("findInteractive", () => {
  it("returns null for targets that cannot be walked (text nodes, null)", () => {
    expect(findInteractive(null)).toBeNull();
    expect(findInteractive({} as EventTarget)).toBeNull();
  });

  it("delegates to closest() with the interactive selector", () => {
    const hit = { tagName: "BUTTON" };
    const target = { closest: vi.fn(() => hit) } as unknown as EventTarget;
    expect(findInteractive(target)).toBe(hit);
    const sel = (target as unknown as { closest: ReturnType<typeof vi.fn> }).closest.mock.calls[0][0] as string;
    expect(sel).toContain("button");
    expect(sel).toContain('[role="tab"]');
  });
});

describe("createBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flushes as one batch when the buffer reaches max", () => {
    const send = vi.fn();
    const b = createBatcher<number>(send, { max: 3, intervalMs: 5_000 });
    b.push(1);
    b.push(2);
    expect(send).not.toHaveBeenCalled();
    b.push(3);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([1, 2, 3]);
    expect(b.size()).toBe(0);
  });

  it("flushes after the interval even when the buffer is not full", () => {
    const send = vi.fn();
    const b = createBatcher<number>(send, { max: 20, intervalMs: 5_000 });
    b.push(1);
    vi.advanceTimersByTime(4_999);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledWith([1]);
  });

  it("arms one timer per batch, not one per item", () => {
    const send = vi.fn();
    const b = createBatcher<number>(send, { max: 20, intervalMs: 5_000 });
    b.push(1);
    vi.advanceTimersByTime(3_000);
    b.push(2); // must not restart the clock
    vi.advanceTimersByTime(2_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([1, 2]);
  });

  it("flush() sends immediately, clears the pending timer, and is a no-op when empty", () => {
    const send = vi.fn();
    const b = createBatcher<number>(send, { max: 20, intervalMs: 5_000 });
    b.flush();
    expect(send).not.toHaveBeenCalled();
    b.push(7);
    b.flush();
    expect(send).toHaveBeenCalledWith([7]);
    vi.advanceTimersByTime(10_000);
    // The earlier timer was cleared by flush(); nothing double-sends.
    expect(send).toHaveBeenCalledTimes(1);
  });
});
