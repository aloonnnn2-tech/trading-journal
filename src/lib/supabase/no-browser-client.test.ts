import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_OPTIONS } from "./cookie-options";

// Security gaps pass, Phase 1b (G-4): the session cookie is HttpOnly, which
// only holds while nothing in the browser talks to Supabase. A browser
// Supabase client would see no session (it can't read the cookie) and look
// signed out -- and the obvious "fix", turning HttpOnly off, would hand the
// session back to any injected script. This keeps it from creeping back.

const SRC = path.resolve(__dirname, "../..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.(tsx?|jsx?)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

describe("no Supabase client in the browser", () => {
  const files = sources(SRC).map((f) => ({ rel: path.relative(SRC, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }));

  it("never creates a browser Supabase client", () => {
    expect(files.filter((f) => /createBrowserClient/.test(f.text)).map((f) => f.rel)).toEqual([]);
  });

  it("has no client component that calls Supabase auth or data APIs directly", () => {
    const offenders = files
      .filter((f) => /^\s*["']use client["']/m.test(f.text))
      .filter((f) => /@supabase\/(supabase-js|ssr)["']/.test(f.text.replace(/import\s+type[^;]+;/g, "")))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("writes the session cookie HttpOnly, SameSite=Lax", () => {
    expect(SESSION_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(SESSION_COOKIE_OPTIONS.sameSite).toBe("lax");
  });
});
