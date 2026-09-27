import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_ID,
  ANNOUNCEMENT_SCRIPT,
  ANNOUNCEMENT_STORAGE_KEY,
  isAnnouncementDismissed,
} from "./announcement";

describe("isAnnouncementDismissed", () => {
  it("is dismissed only when the stored id is the current announcement", () => {
    expect(isAnnouncementDismissed(ANNOUNCEMENT_ID)).toBe(true);
  });

  it("shows the bar to someone who never closed it", () => {
    expect(isAnnouncementDismissed(null)).toBe(false);
    expect(isAnnouncementDismissed(undefined)).toBe(false);
  });

  it("shows a NEW announcement to someone who closed an old one", () => {
    expect(isAnnouncementDismissed("an-older-announcement")).toBe(false);
    expect(isAnnouncementDismissed(ANNOUNCEMENT_ID, "the-next-one")).toBe(false);
  });

  it("treats garbage in storage as not dismissed", () => {
    expect(isAnnouncementDismissed("")).toBe(false);
    expect(isAnnouncementDismissed("true")).toBe(false);
  });
});

describe("ANNOUNCEMENT_SCRIPT", () => {
  // The pre-paint script is a string, so check it actually does what the
  // component expects, by running it against a stand-in document.
  function run(stored: string | null, throws = false) {
    const attrs: Record<string, string> = {};
    const localStorage = {
      getItem: (k: string) => {
        if (throws) throw new Error("storage disabled");
        return k === ANNOUNCEMENT_STORAGE_KEY ? stored : null;
      },
    };
    const document = { documentElement: { setAttribute: (n: string, v: string) => (attrs[n] = v) } };
    new Function("localStorage", "document", ANNOUNCEMENT_SCRIPT)(localStorage, document);
    return attrs;
  }

  it("marks <html> when this announcement was closed", () => {
    expect(run(ANNOUNCEMENT_ID)).toHaveProperty("data-announcement-dismissed");
  });

  it("leaves <html> alone otherwise", () => {
    expect(run(null)).toEqual({});
    expect(run("an-older-announcement")).toEqual({});
  });

  it("never throws when storage does", () => {
    expect(() => run(null, true)).not.toThrow();
    expect(run(null, true)).toEqual({});
  });
});
