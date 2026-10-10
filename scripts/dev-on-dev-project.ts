/**
 * `next dev` against the DEV Supabase project instead of production, for
 * looking at accounts made by `npm run seed:fake` or poking at sign-up
 * without creating a real account. Refuses the production URL.
 *
 *   npm run dev:devdb            (port 3003, or pass -- --port N)
 *
 * Next 16 locks .next/dev, so stop the regular dev server first.
 */
import { spawn } from "node:child_process";
import { devServerEnv, loadDevProject } from "../src/lib/env/dev-project";

const dev = loadDevProject(process.cwd());
const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? process.argv[portArg + 1] : "3003";
console.log(`Dev project ${dev.host} on http://localhost:${port}`);

const child = spawn("npx", ["next", "dev", "--port", port], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ...devServerEnv(dev) },
});
child.on("exit", (code) => process.exit(code ?? 0));
