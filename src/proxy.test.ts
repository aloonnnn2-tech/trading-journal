import { describe, expect, it } from "vitest";
import { apiCacheControl, config, isCrossSite } from "./proxy";

// The CSRF predicate for state-changing /api requests. It must refuse a
// browser page on another site and let through everything that is not a
// browser page (cron pings, curl), so the two signals browsers send --
// Sec-Fetch-Site and Origin -- are read exactly as they are specified.

function req(headers: Record<string, string>) {
  return { headers: new Headers(headers) };
}

describe("isCrossSite", () => {
  it("refuses a request the browser labels cross-site", () => {
    expect(isCrossSite(req({ "sec-fetch-site": "cross-site", origin: "https://evil.example", host: "app.example" }))).toBe(true);
  });

  it("accepts same-origin, same-site and user-initiated navigations", () => {
    for (const site of ["same-origin", "same-site", "none"]) {
      expect(isCrossSite(req({ "sec-fetch-site": site, origin: "https://evil.example", host: "app.example" }))).toBe(false);
    }
  });

  it("falls back to Origin vs Host when Sec-Fetch-Site is absent", () => {
    expect(isCrossSite(req({ origin: "https://app.example", host: "app.example" }))).toBe(false);
    expect(isCrossSite(req({ origin: "https://evil.example", host: "app.example" }))).toBe(true);
    expect(isCrossSite(req({ origin: "https://app.example", "x-forwarded-host": "app.example", host: "internal" }))).toBe(false);
  });

  it("treats an opaque 'null' Origin as cross-site (sandboxed frames, data: URLs)", () => {
    expect(isCrossSite(req({ origin: "null", host: "app.example" }))).toBe(true);
  });

  it("lets a request with neither header through: not a browser page, not a CSRF vector", () => {
    expect(isCrossSite(req({ host: "app.example" }))).toBe(false);
  });

  it("refuses an Origin that does not parse", () => {
    expect(isCrossSite(req({ origin: "not a url", host: "app.example" }))).toBe(true);
  });
});

describe("apiCacheControl", () => {
  it("keeps every signed-in API read out of shared caches", () => {
    for (const path of ["/api/trades", "/api/trades/abc/panel", "/api/account/export", "/api/market-data/bars", "/api/ai-keys"]) {
      const value = apiCacheControl("GET", path);
      expect(value, path).toContain("private");
      expect(value, path).toContain("no-store");
      expect(value, path).not.toMatch(/public|s-maxage|max-age=[1-9]/);
    }
  });

  it("leaves writes and pages alone, and the chat stream to its own header", () => {
    expect(apiCacheControl("POST", "/api/trades")).toBeNull();
    expect(apiCacheControl("GET", "/dashboard")).toBeNull();
    expect(apiCacheControl("GET", "/api/chat/conversations/x/turn")).toBeNull();
  });
});

describe("the proxy matcher", () => {
  // Next applies the pattern to the whole pathname; the same anchoring here.
  const runs = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

  it("runs on every page and API path, including ones that merely END in an image extension", () => {
    // These used to skip the proxy, so a forged x-user-id reached page code (G-13).
    for (const path of ["/trades/x.png", "/admin/users/abc.jpg", "/strategies/a.webp", "/api/folders/x.png", "/dashboard", "/api/trades"]) {
      expect(runs(path), path).toBe(true);
    }
  });

  it("still skips the static files public/ serves, Next's assets, and the cron routes", () => {
    for (const path of ["/brand-mark.png", "/example-trade-screenshot.png", "/screenshots/journal.png", "/_next/static/chunk.js", "/favicon.ico", "/api/cron/auto-execute"]) {
      expect(runs(path), path).toBe(false);
    }
  });
});
