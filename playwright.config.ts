import { defineConfig, devices } from "@playwright/test";
import { devServerEnv, loadDevProject } from "./src/lib/env/dev-project";

/**
 * End-to-end tests for the three flows unit tests cannot reach.
 *
 * The 935 Vitest tests are all pure logic -- computation, parsing, validation,
 * date maths. They cannot see a debounce that never fires, a form that
 * auto-fills with the wrong value, or an auth error that renders GoTrue's own
 * wording. Those are the regressions that quietly cost a user their trade
 * data, so they are what these cover. See e2e/README.md.
 */

// The suite creates and deletes users, so it runs against the DEV Supabase
// project only (.env.test.local), never production -- loadDevProject throws
// if it would. Nothing from .env.local enters this process except
// production's URL, read only to be refused. See docs/dev-accounts.md.
const dev = loadDevProject(process.cwd());

// Dev keys, Cloudflare's always-pass Turnstile test key, a throwaway
// encryption secret (src/lib/env/dev-project.ts).
const serverEnv = devServerEnv(dev);
// The fixtures (createTestUser etc.) read these from this process.
Object.assign(process.env, serverEnv);

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Chromium only for this pass, per the brief. Adding browsers is a matter of
  // adding projects here; the specs contain nothing engine-specific.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // **Serial, deliberately.** These tests write to a real (dev) Supabase project.
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

  // Always its own server, never one already running: a running `next dev`
  // reads .env.local, so it talks to PRODUCTION, and the sign-up test would
  // create a real account there. Next 16 locks .next/dev, so stop your own
  // dev server before a run (the error says so if you forget).
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    env: serverEnv,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
