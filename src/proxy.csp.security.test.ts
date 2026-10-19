import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCsp } from "./proxy";

// Security gaps pass, 7.1: the Content-Security-Policy is the backstop
// behind every XSS fix (no unsafe HTML on the AI paths, the trade schema's
// character rule). These pin the directives that make it worth having, so a
// "small tweak" that guts it fails here instead of shipping.

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name, values]),
  );
}

afterEach(() => vi.unstubAllEnvs());

describe("the production CSP", () => {
  const csp = directives(buildCsp("n0nce-abc"));

  it("runs only nonced scripts and what they load, never inline or eval", () => {
    const script = csp.get("script-src")!;
    expect(script).toContain("'nonce-n0nce-abc'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(script.some((s) => s === "*" || s.endsWith(":") || s.includes("*"))).toBe(false);
  });

  it("allows no plugins, no <base> re-pointing and no off-site form posts", () => {
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);
    expect(csp.get("default-src")).toEqual(["'self'"]);
  });

  it("can't be framed, and frames only Turnstile", () => {
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("frame-src")).toEqual(["https://challenges.cloudflare.com"]);
  });

  it("has no wildcard sources anywhere", () => {
    for (const [name, values] of csp) {
      expect(values.filter((v) => v === "*" || /^https?:\/\/\*/.test(v)), name).toEqual([]);
    }
  });

  it("reports violations", () => {
    expect(csp.get("report-uri")).toEqual(["/api/csp-report"]);
  });
});

describe("the development CSP", () => {
  it("adds eval for React's dev tooling only when NODE_ENV is development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(directives(buildCsp("x")).get("script-src")).toContain("'unsafe-eval'");
  });
});
