import { describe, expect, it, vi, beforeEach } from "vitest";

// Captured instead of sent. The assertions below are all about what WOULD
// reach Sentry, which is the only externally visible effect this route has --
// it answers 204 to everything, so a test that only checked status codes
// would pass just as happily with the whole body commented out.
const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

const { POST } = await import("./route");

/** Unique per test so the per-signature cap in the route can't leak between
 *  them -- rateLimit keeps module-level state that vi.resetModules would not
 *  clear anyway, since it lives in a separate module. */
let counter = 0;
function uniqueDirective(): string {
  counter += 1;
  return `test-directive-${counter}`;
}

function post(body: unknown, contentType = "application/csp-report"): Promise<Response> {
  return POST(
    new Request("https://tradinglenz.netlify.app/api/csp-report", {
      method: "POST",
      headers: { "content-type": contentType },
      body: JSON.stringify(body),
    }),
  );
}

/** The legacy `report-uri` shape: one hyphenated object. Firefox and Safari. */
function reportUri(overrides: Record<string, unknown> = {}) {
  return {
    "csp-report": {
      "document-uri": "https://tradinglenz.netlify.app/trades",
      "effective-directive": "script-src",
      "blocked-uri": "https://evil.example.com/x.js",
      "source-file": "https://tradinglenz.netlify.app/trades",
      "line-number": 12,
      disposition: "report",
      ...overrides,
    },
  };
}

/** The Reporting API shape: an array of typed envelopes. Chromium. */
function reportTo(body: Record<string, unknown> = {}) {
  return [
    {
      type: "csp-violation",
      url: "https://tradinglenz.netlify.app/trades",
      body: {
        documentURL: "https://tradinglenz.netlify.app/trades",
        effectiveDirective: "script-src",
        blockedURL: "https://evil.example.com/x.js",
        disposition: "report",
        ...body,
      },
    },
  ];
}

beforeEach(() => {
  captureMessage.mockClear();
});

describe("CSP report collector", () => {
  it("always answers 204, so a browser never retries", async () => {
    expect((await post(reportUri({ "effective-directive": uniqueDirective() }))).status).toBe(204);
    expect((await post("not json at all")).status).toBe(204);
    expect((await post([])).status).toBe(204);
  });

  it("accepts the legacy report-uri format", async () => {
    const directive = uniqueDirective();
    await post(reportUri({ "effective-directive": directive }));

    expect(captureMessage).toHaveBeenCalledOnce();
    const [message, context] = captureMessage.mock.calls[0];
    expect(message).toContain(directive);
    expect(message).toContain("https://evil.example.com");
    expect(context.tags.csp_directive).toBe(directive);
  });

  it("accepts the Reporting API format", async () => {
    const directive = uniqueDirective();
    await post(reportTo({ effectiveDirective: directive }), "application/reports+json");

    expect(captureMessage).toHaveBeenCalledOnce();
    expect(captureMessage.mock.calls[0][1].tags.csp_directive).toBe(directive);
  });

  it("falls back to violated-directive when effective-directive is absent", async () => {
    const directive = uniqueDirective();
    await post({
      "csp-report": {
        "violated-directive": `${directive} 'self' 'nonce-abc'`,
        "blocked-uri": "https://evil.example.com/x.js",
      },
    });

    expect(captureMessage).toHaveBeenCalledOnce();
    expect(captureMessage.mock.calls[0][1].tags.csp_directive).toContain(directive);
  });

  it("ignores non-CSP entries in a Reporting API batch", async () => {
    await post(
      [
        { type: "deprecation", body: { id: "x" } },
        { type: "intervention", body: { id: "y" } },
      ],
      "application/reports+json",
    );

    expect(captureMessage).not.toHaveBeenCalled();
  });

  describe("browser-extension noise", () => {
    // The filter that decides whether this endpoint is usable at all: without
    // it, the reports are mostly a census of users' installed extensions.
    for (const scheme of [
      "chrome-extension://abcdef/inject.js",
      "moz-extension://abcdef/inject.js",
      "safari-web-extension://abcdef/inject.js",
      "about:blank",
    ]) {
      it(`drops a violation blocked at ${scheme.split("/")[0]}`, async () => {
        await post(reportUri({ "effective-directive": uniqueDirective(), "blocked-uri": scheme }));
        expect(captureMessage).not.toHaveBeenCalled();
      });
    }

    it("drops it when only the source file is an extension", async () => {
      await post(
        reportUri({
          "effective-directive": uniqueDirective(),
          "blocked-uri": "inline",
          "source-file": "chrome-extension://abcdef/inject.js",
        }),
      );
      expect(captureMessage).not.toHaveBeenCalled();
    });

    it("still reports a real violation from our own origin", async () => {
      const directive = uniqueDirective();
      await post(reportUri({ "effective-directive": directive, "blocked-uri": "inline" }));
      expect(captureMessage).toHaveBeenCalledOnce();
      expect(captureMessage.mock.calls[0][1].tags.csp_blocked_origin).toBe("inline");
    });
  });

  it("groups by origin, not by full URL", async () => {
    const directive = uniqueDirective();
    await post(reportUri({ "effective-directive": directive, "blocked-uri": "https://cdn.example.com/a.js?v=1" }));
    await post(reportUri({ "effective-directive": directive, "blocked-uri": "https://cdn.example.com/b.js?v=2" }));

    // Two different URLs, one fingerprint -- otherwise a cache-busted asset
    // would open a new Sentry issue on every deploy.
    const fingerprints = captureMessage.mock.calls.map((call) => call[1].fingerprint.join("|"));
    expect(new Set(fingerprints).size).toBe(1);
    expect(captureMessage.mock.calls[0][1].tags.csp_blocked_origin).toBe("https://cdn.example.com");
  });

  it("caps repeats of one signature so Sentry can't be flooded", async () => {
    const directive = uniqueDirective();
    for (let i = 0; i < 25; i += 1) {
      await post(reportUri({ "effective-directive": directive }));
    }

    // REPORT_CAP is 5 per 10 minutes. The 25 attempts are what a single
    // broken directive on a busy page looks like.
    expect(captureMessage).toHaveBeenCalledTimes(5);
  });

  it("marks an enforced violation as an error, a report-only one as a warning", async () => {
    await post(reportUri({ "effective-directive": uniqueDirective(), disposition: "enforce" }));
    expect(captureMessage.mock.calls[0][1].level).toBe("error");

    captureMessage.mockClear();
    await post(reportUri({ "effective-directive": uniqueDirective(), disposition: "report" }));
    expect(captureMessage.mock.calls[0][1].level).toBe("warning");
  });

  it("drops an oversized body rather than parsing it", async () => {
    await post(reportUri({ "effective-directive": uniqueDirective(), "script-sample": "x".repeat(70_000) }));
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
