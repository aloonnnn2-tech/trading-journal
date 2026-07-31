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
