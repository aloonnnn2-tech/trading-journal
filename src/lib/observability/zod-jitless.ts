// zod 4 speeds up object parsing with generated code, and first probes for
// it with `Function("")`. The enforcing CSP (no 'unsafe-eval') blocks that
// probe -- harmlessly, zod falls back -- but every page that parsed with zod
// then raised a CSP violation and sent a report (found 2026-10-11 checking
// the production build). `jitless` tells zod never to try.
//
// Set through the global object zod keeps its config on, instead of
// `import { z } from "zod"; z.config(...)`: that import, in
// instrumentation-client, made every page download zod (about 51 KB
// compressed) -- the homepage and sign-in included, which never validate
// anything in the browser (full check, 2026-10-12). zod reads and reuses
// this object whether it loads before or after this runs
// (`globalThis.__zod_globalConfig ??= {}` in zod/v4/core/core.js);
// zod-jitless.test.ts fails if a zod upgrade stops doing that.

type ZodGlobalConfig = { jitless?: boolean };

export function setZodJitless(): void {
  const g = globalThis as { __zod_globalConfig?: ZodGlobalConfig };
  g.__zod_globalConfig ??= {};
  g.__zod_globalConfig.jitless = true;
}
