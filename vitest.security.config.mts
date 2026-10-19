// The security regression suite (npm run test:security): the unit tests
// listed in tests/security/suite.ts, with the same setup as the main config.
// The cross-user suite on the dev project is vitest.idor.config.mts.
import { defineConfig } from "vitest/config";
import base from "./vitest.config.mjs";
import { SECURITY_TEST_FILES } from "./tests/security/suite";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    // Replaces the main config's src/**, not added to it (mergeConfig would
    // concatenate). Brackets in [id] folders are globs to vitest, so escaped.
    include: SECURITY_TEST_FILES.map((f) => f.replace(/[[\]]/g, "\\$&")),
  },
});
