import { describe, expect, it } from "vitest";
import { setZodJitless } from "./zod-jitless";

// setZodJitless never imports zod (so pages that don't validate in the
// browser don't download it). It relies on zod keeping its config on
// globalThis.__zod_globalConfig and reusing an object already there; these
// tests fail if a zod upgrade changes that.
type G = { __zod_globalConfig?: { jitless?: boolean } };

describe("setZodJitless", () => {
  it("sets jitless on the very object zod reads its config from", async () => {
    setZodJitless(); // the browser order: before any app code loads zod
    const { z } = await import("zod");
    expect(z.config()).toBe((globalThis as G).__zod_globalConfig);
    expect(z.config().jitless).toBe(true);
  });

  it("takes effect when zod has already loaded", async () => {
    const { z } = await import("zod");
    z.config({ jitless: false });
    expect(z.config().jitless).toBe(false);
    setZodJitless();
    expect(z.config().jitless).toBe(true);
  });
});
