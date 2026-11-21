import { describe, expect, it } from "vitest";
import {
  onboardingEmail,
  pickOnboardingEmail,
  readOnboardingState,
  writeOnboardingState,
  type OnboardingCandidate,
} from "./onboarding";

const NOW = new Date("2026-11-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

function cand(over: Partial<OnboardingCandidate> = {}): OnboardingCandidate {
  return { createdAt: hoursAgo(1), emailConfirmedAt: hoursAgo(1), state: {}, excluded: false, ...over };
}

/** Words in the body the reader sees, without the unsubscribe footer. */
function bodyWords(text: string): number {
  return text.split("\n--\n")[0].split(/\s+/).filter((w) => w && !w.startsWith("http")).length;
}

describe("onboarding email text", () => {
  for (const kind of ["welcome", "nudge"] as const) {
    it(`${kind}: under 80 words, no founder name, has the unsubscribe link`, () => {
      const mail = onboardingEmail(kind, "https://x.test/unsub");
      expect(bodyWords(mail.text)).toBeLessThan(80);
      expect(mail.text).not.toMatch(/alon/i);
      expect(mail.text).toContain("https://x.test/unsub");
      expect(mail.text).toContain("/dashboard");
      expect(mail.text).toMatch(/screenshot/i);
    });
  }
});

describe("pickOnboardingEmail", () => {
  it("welcomes a confirmed account made in the last day", () => {
    expect(pickOnboardingEmail(cand(), NOW)).toBe("welcome");
  });

  it("never welcomes an account that predates the sender", () => {
    expect(pickOnboardingEmail(cand({ createdAt: hoursAgo(30) }), NOW)).toBeNull();
  });

  it("sends nothing unconfirmed, excluded or opted out", () => {
    expect(pickOnboardingEmail(cand({ emailConfirmedAt: null }), NOW)).toBeNull();
    expect(pickOnboardingEmail(cand({ excluded: true }), NOW)).toBeNull();
    expect(pickOnboardingEmail(cand({ state: { optedOut: true } }), NOW)).toBeNull();
  });

  it("nudges from 48h, a day after the welcome, until a week", () => {
    const welcomed = (age: number, welcomeAge: number) =>
      cand({ createdAt: hoursAgo(age), state: { welcomeSentAt: hoursAgo(welcomeAge) } });
    expect(pickOnboardingEmail(welcomed(47, 46), NOW)).toBeNull();
    expect(pickOnboardingEmail(welcomed(49, 48), NOW)).toBe("nudge-if-no-trade");
    expect(pickOnboardingEmail(welcomed(49, 10), NOW)).toBeNull();
    expect(pickOnboardingEmail(welcomed(24 * 8, 24 * 7), NOW)).toBeNull();
  });

  it("never sends the nudge twice", () => {
    expect(
      pickOnboardingEmail(
        cand({ createdAt: hoursAgo(60), state: { welcomeSentAt: hoursAgo(59), nudgeSentAt: hoursAgo(5) } }),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("state round trip", () => {
  it("writes and reads back", () => {
    const s = { welcomeSentAt: hoursAgo(3), nudgeSentAt: null, optedOut: true };
    expect(readOnboardingState(writeOnboardingState(s))).toEqual(s);
  });
  it("reads junk as empty", () => {
    expect(readOnboardingState({ onboarding_emails: "x" })).toEqual({
      welcomeSentAt: null,
      nudgeSentAt: null,
      optedOut: false,
    });
    expect(readOnboardingState(null).optedOut).toBe(false);
  });
});
