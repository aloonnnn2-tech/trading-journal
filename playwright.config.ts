import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the three flows unit tests cannot reach.
 *
 * The 935 Vitest tests are all pure logic -- computation, parsing, validation,
 * date maths. They cannot see a debounce that never fires, a form that
 * auto-fills with the wrong value, or an auth error that renders GoTrue's own
 * wording. Those are the regressions that quietly cost a user their trade
 * data, so they are what these cover. See e2e/README.md.
 */

// Node 20.12+ builtin -- no dotenv dependency. The tests need
// SUPABASE_SERVICE_ROLE_KEY (to mint and clean up their own throwaway user);
// `next dev` loads .env.local itself, but this config process does not.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Absent in CI, where the values come from the environment directly.
}

const PORT = Number(process.env.E2E_PORT ?? 3000);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Chromium only for this pass, per the brief. Adding browsers is a matter of
  // adding projects here; the specs contain nothing engine-specific.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // **Serial, deliberately.** These tests write to a real Supabase project.
  // Parallel workers would interleave trade creation and deletion against one
  // database, and a flake caused by another worker's row is the kind of thing
  // that gets a whole suite disabled rather than debugged.
  workers: 1,
  fullyParallel: false,

  // A cold `next dev` compiles each route on first request, and the trade page
  // is the heaviest in the app. Generous timeouts here are about the dev
  // server, not about the assertions.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  // Retries locally too, not just in CI: the flows under test involve real
  // network round-trips to Supabase, and one retry distinguishes "genuinely
  // broken" from "the connection blipped" without hiding a real failure.
  retries: process.env.CI ? 2 : 1,

  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    // Artefacts only for failures -- a passing run should leave nothing
    // behind to sift through.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
