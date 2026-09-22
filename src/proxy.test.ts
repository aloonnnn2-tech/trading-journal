import { describe, expect, it } from "vitest";
import { isCrossSite } from "./proxy";

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
