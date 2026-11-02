import { describe, expect, it } from "vitest";
import { CORE_SUBJECTS, DERIVED_SUBJECTS } from "@/lib/plan-rules/subjects";
import { RULE_GROUPS, rulesAsText } from "./trading-rules";

const SUBJECT_KEYS = new Set([...CORE_SUBJECTS, ...DERIVED_SUBJECTS].map((s) => s.key));
const ALL_RULES = RULE_GROUPS.flatMap((g) => g.rules);

describe("example trading rules", () => {
  // The page tells visitors Trading Lens checks these automatically. That is
  // only true if the app has a rule subject for it.
  it("only badges rules that map to a real plan-rule subject", () => {
    for (const rule of ALL_RULES.filter((r) => r.checksWith)) {
      expect(SUBJECT_KEYS, rule.text).toContain(rule.checksWith);
    }
  });

  it("has no duplicate rules, and every rule says why", () => {
    const texts = ALL_RULES.map((r) => r.text);
    expect(new Set(texts).size).toBe(texts.length);
    for (const rule of ALL_RULES) expect(rule.why.length, rule.text).toBeGreaterThan(10);
  });

  it("copies every rule under its group heading", () => {
    const text = rulesAsText();
    for (const group of RULE_GROUPS) expect(text).toContain(group.heading.toUpperCase());
    for (const rule of ALL_RULES) expect(text).toContain(`- ${rule.text}`);
  });
});
