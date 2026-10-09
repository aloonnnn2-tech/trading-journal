import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Cross-user (IDOR) suite: user A asks for user B's records, through the
// real route handlers and directly through PostgREST, against the DEV
// Supabase project in .env.test.local. Never the live one -- tests/idor/env.ts
// refuses to start if the URL is production's. Kept out of `npm test`
// because it needs the network and that project. Run: npm run test:idor
//
// Same aliases as vitest.config.mts (see the reasons there); not imported
// from it because tsc refuses `.mts` import paths in this project.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/idor/**/*.idor.test.ts"],
    setupFiles: ["tests/idor/env.ts"],
    // Shared users per file and real network round-trips.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
