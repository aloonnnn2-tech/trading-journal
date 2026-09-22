import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBatcher,
  deriveLabel,
  describeClick,
  findInteractive,
  startClickCapture,
  type ClickEvent,
} from "./click-capture";

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

// ---- Regressions from the real leaks found in production -----------------
//
// These reproduce the exact element shapes that were writing user content
// into analytics_events. The pre-existing privacy tests passed while this was
// happening because they applied data-track-private synthetically; these
// start from the markup as it actually shipped.

describe("deriveLabel: leaks found live", () => {
  it("does not record an aria-label that names a money figure", () => {
    // The delete button on a cash adjustment. aria-label used to be read
    // ABOVE the privacy guard, so marking the row private did not help.
    const row = el("li", { attrs: { "data-track-private": "" } });
    const button = el("button", {
      attrs: { "aria-label": "Delete the $12,400.00 adjustment", title: "Delete adjustment" },
      parent: row,
    });

    expect(deriveLabel(button as unknown as Element)).toBeNull();
  });

  it("still uses aria-label for an ordinary control outside a private subtree", () => {
    // Moving aria-label below the guard must not blind analytics to the
    // icon-only buttons it is there to name.
    const button = el("button", { attrs: { "aria-label": "Close dialog" } });

    expect(deriveLabel(button as unknown as Element)).toBe("Close dialog");
  });

  it("does not record another person's email from the admin directory", () => {
    // The row that was already storing "someone@example.comyoupaidadmin".
    const cell = el("td", { attrs: { "data-track-private": "" } });
    const link = el("a", {
      text: "someone@example.com you paid admin",
      attrs: { href: "/admin/users/abc" },
      parent: cell,
    });

    expect(deriveLabel(link as unknown as Element)).toBeNull();
  });

  it("does not record a user-authored folder or strategy name", () => {
    const wrapper = el("div", { attrs: { "data-track-private": "" } });
    const folder = el("label", { text: "Swing setups Q4", parent: wrapper });
    const strategy = el("label", { text: "Revenge trade after NVDA", parent: wrapper });

    expect(deriveLabel(folder as unknown as Element)).toBeNull();
    expect(deriveLabel(strategy as unknown as Element)).toBeNull();
  });

  it("keeps developer-authored identifiers working inside a private subtree", () => {
    // data-track and id sit ABOVE the guard on purpose: they are written by
    // us, never by the user, and they are what makes a private row countable.
    const wrapper = el("div", { attrs: { "data-track-private": "" } });
    const tagged = el("button", { attrs: { "data-track": "delete-adjustment" }, parent: wrapper });

    expect(deriveLabel(tagged as unknown as Element)).toBe("delete-adjustment");
  });
});

describe("startClickCapture: label double-count", () => {
  // The shared el() fake only answers the privacy selector, so these build
  // their own nodes whose closest() also resolves the INTERACTIVE selector --
  // which is what findInteractive actually calls.
  const INTERACTIVE_TAGS = new Set(["BUTTON", "A", "LABEL", "SUMMARY"]);

  interface Node {
    tagName: string;
    id: string;
    textContent: string;
    attrs: Record<string, string>;
    parent: Node | null;
    getAttribute: (n: string) => string | null;
    closest: (sel: string) => Node | null;
  }

  function node(tagName: string, { text = "", parent = null as Node | null } = {}): Node {
    const n: Node = {
      tagName: tagName.toUpperCase(),
      id: "",
      textContent: text,
      attrs: {},
      parent,
      getAttribute: (k) => (k in n.attrs ? n.attrs[k] : null),
      closest: (sel) => {
        let cur: Node | null = n;
        while (cur) {
          if (sel === "[data-track-private]") {
            if ("data-track-private" in cur.attrs) return cur;
          } else if (INTERACTIVE_TAGS.has(cur.tagName)) {
            return cur;
          }
          cur = cur.parent;
        }
        return null;
      },
    };
    return n;
  }

  function harness() {
    const sent: ClickEvent[][] = [];
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    vi.stubGlobal("document", {
      addEventListener: (t: string, fn: (e: unknown) => void) => {
        (listeners[t] ??= []).push(fn);
      },
      removeEventListener: () => {},
      visibilityState: "visible",
    });
    vi.stubGlobal("window", {
      addEventListener: () => {},
      removeEventListener: () => {},
      location: { pathname: "/trades" },
    });
    const stop = startClickCapture((evts) => sent.push(evts));
    return { sent, stop, fire: (target: Node) => listeners.click.forEach((fn) => fn({ target })) };
  }

  afterEach(() => vi.unstubAllGlobals());

  it("records a label-wrapped checkbox once, not twice", () => {
    const { sent, stop, fire } = harness();
    const label = node("label", { text: "Swing setups" });
    const input = node("input", { parent: label });

    // The real sequence: the user's click on the <label>, then the synthetic
    // click the label forwards to its <input>, which bubbles back through it
    // and resolves to the same <label>.
    fire(label);
    fire(input);
    stop();

    expect(sent.flat()).toHaveLength(1);
  });

  it("still records two genuine clicks on the same control", async () => {
    const { sent, stop, fire } = harness();
    const button = node("button", { text: "Add trade" });

    fire(button);
    await new Promise((r) => setTimeout(r, 40)); // wider than DEDUPE_WINDOW_MS
    fire(button);
    stop();

    expect(sent.flat()).toHaveLength(2);
  });

  it("does not merge clicks on two different controls", () => {
    const { sent, stop, fire } = harness();

    fire(node("button", { text: "One" }));
    fire(node("button", { text: "Two" }));
    stop();

    expect(sent.flat()).toHaveLength(2);
  });
});
