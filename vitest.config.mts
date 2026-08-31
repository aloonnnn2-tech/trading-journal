import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// `.mts` because package.json has no `"type": "module"` -- a plain
// vitest.config.ts would be loaded as CommonJS and reject the ESM syntax.
export default defineConfig({
  resolve: {
    // Mirrors tsconfig's `@/* -> ./src/*` so tests import modules exactly the
    // way the app does, rather than through brittle relative paths.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // src/lib/supabase/admin.ts and src/lib/ai-keys/crypto.ts import
      // "server-only" so that pulling them into a client bundle fails the
      // build. That package throws on import unless resolved under the
      // "react-server" condition, which Next sets and vitest does not -- so
      // without this the guard breaks the unit tests for those modules.
      // Aliased to the no-op the package itself ships for that condition,
      // rather than adding "react-server" to resolve.conditions, which would
      // also change how React and every other package resolves here.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    // Only unit tests over pure logic. Deliberately excludes the OCR eval
    // suite (scripts/ocr-eval), which is a separate accuracy harness needing
    // real image fixtures and is run via `npm run ocr:eval`.
    include: ["src/**/*.test.ts"],
  },
});
