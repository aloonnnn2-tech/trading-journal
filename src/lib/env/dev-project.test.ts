import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { devServerEnv, loadDevProject } from "./dev-project";

const PROD = "https://prodprodprodprodprod.supabase.co";
const DEV = "https://devdevdevdevdevdevdev.supabase.co";
const saved = { ...process.env };

function dir(testEnv: string, local = `NEXT_PUBLIC_SUPABASE_URL=${PROD}\n`) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "devproj-"));
  fs.writeFileSync(path.join(d, ".env.test.local"), testEnv);
  if (local) fs.writeFileSync(path.join(d, ".env.local"), local);
  return d;
}

afterEach(() => {
  process.env = { ...saved };
});

describe("loadDevProject", () => {
  for (const k of ["SUPABASE_DEV_URL", "SUPABASE_DEV_ANON_KEY", "SUPABASE_DEV_SERVICE_ROLE_KEY", "SUPABASE_PROD_URL"]) {
    delete process.env[k];
  }
  const keys = "SUPABASE_DEV_ANON_KEY=a\nSUPABASE_DEV_SERVICE_ROLE_KEY=s\n";

  it("returns the dev project, origin only", () => {
    const p = loadDevProject(dir(`SUPABASE_DEV_URL=${DEV}/rest/v1/\n${keys}`));
    expect(p.url).toBe(DEV);
    expect(p.serviceRoleKey).toBe("s");
    expect(devServerEnv(p).NEXT_PUBLIC_SUPABASE_URL).toBe(DEV);
  });

  it("refuses the production project", () => {
    expect(() => loadDevProject(dir(`SUPABASE_DEV_URL=${PROD}\n${keys}`))).toThrow(/PRODUCTION/);
  });

  it("fails closed when it can't tell what production is, or keys are missing", () => {
    expect(() => loadDevProject(dir(`SUPABASE_DEV_URL=${DEV}\n${keys}`, ""))).toThrow();
    expect(() => loadDevProject(dir(`SUPABASE_DEV_URL=${DEV}\n`))).toThrow(/SUPABASE_DEV_ANON_KEY/);
  });
});
