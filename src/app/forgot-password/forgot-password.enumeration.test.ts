import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The reset page must answer the same way whether or not an account exists,
// or it tells anyone which emails are registered (security gaps pass, 1.5).
// The page has one success text and shows it for every address; this pins
// that there is no branch on "no such user".
const source = fs.readFileSync(path.join(__dirname, "page.tsx"), "utf8");

describe("forgot-password", () => {
  it("confirms with the same 'if an account exists' wording for every address", () => {
    expect(source).toMatch(/If an account exists for/);
  });

  it("never branches on whether the account exists", () => {
    expect(source).not.toMatch(/user_not_found|email_not_found|no account|isn't registered|not registered/i);
  });
});
