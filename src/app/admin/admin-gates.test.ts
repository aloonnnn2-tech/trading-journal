import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every admin page and admin API route must run its own server-side admin
// check. The /admin layout is only a backstop (layouts don't re-run on
// client navigation), and an admin route without a check is reachable by
// any signed-in user who knows the URL. This fails the build-time test run
// the day someone adds one without it.

const root = path.resolve(__dirname, "../..");

function files(dir: string, name: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(full, name));
    else if (entry.name === name) out.push(full);
  }
  return out;
}

const pages = files(path.join(root, "app/admin"), "page.tsx");
const routes = files(path.join(root, "app/api/admin"), "route.ts");

describe("admin gates", () => {
  it("found the admin pages and routes (the scan itself works)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(4);
    expect(routes.length).toBeGreaterThanOrEqual(3);
  });

  it.each(pages.map((p) => [path.relative(root, p)]))("%s checks isAdmin() and redirects", (rel) => {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    expect(src).toMatch(/isAdmin\(/);
    expect(src).toMatch(/redirect\(/);
  });

  it.each(routes.map((p) => [path.relative(root, p)]))("%s checks isAdmin() before acting", (rel) => {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    expect(src).toMatch(/isAdmin\(/);
  });
});
