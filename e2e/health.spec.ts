import { expect, test } from "@playwright/test";

/**
 * Health checks (production-readiness item 49): what an uptime monitor
 * watches. Signed out, quick, and saying nothing beyond up or down.
 */
test("liveness and readiness answer without a session and give nothing away", async ({ request }) => {
  const live = await request.get("/api/health");
  expect(live.status()).toBe(200);
  expect(await live.json()).toEqual({ status: "ok" });

  const ready = await request.get("/api/health/ready");
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: "ok" });
  // Never publicly cacheable, like every API answer.
  expect(ready.headers()["cache-control"]).toContain("no-store");
  expect(ready.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
});
