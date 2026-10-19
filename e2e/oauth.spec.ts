import { expect, test } from "@playwright/test";

/**
 * "Continue with Google" (2026-10-15).
 *
 * The real Google screen can't be driven from a test, so this pins the two
 * ends this app owns: the button (shown only when Supabase has Google on,
 * and sending the browser to Supabase's authorize URL with our callback),
 * and the callback's failure paths.
 */

test("no Google button while Supabase has Google switched off", async ({ page }) => {
  await page.route("**/auth/v1/settings", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ external: { email: true, google: false } }) }),
  );
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: /continue with google/i })).toHaveCount(0);
});

test("the Google button sends the browser to Supabase with our callback", async ({ page }) => {
  await page.route("**/auth/v1/settings", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ external: { email: true, google: true } }) }),
  );
  const authorize = new Promise<URL>((resolve) => {
    void page.route("**/auth/v1/authorize**", (r) => {
      resolve(new URL(r.request().url()));
      return r.abort();
    });
  });

  for (const path of ["/sign-up", "/sign-in?next=/review"]) {
    await page.goto(path);
    await page.getByRole("button", { name: "Continue with Google" }).click();
  }
  const url = await authorize;
  expect(url.searchParams.get("provider")).toBe("google");
  expect(new URL(url.searchParams.get("redirect_to")!).pathname).toBe("/auth/callback");
});

test("a cancelled or failed Google sign-in lands on sign-in with a reason", async ({ page }) => {
  await page.goto("/auth/callback?error=access_denied");
  await expect(page).toHaveURL(/\/sign-in\?error=oauth_cancelled/);
  await expect(page.getByText(/Google sign-in was cancelled/)).toBeVisible();

  await page.goto("/auth/callback?code=not-a-real-code");
  await expect(page).toHaveURL(/\/sign-in\?error=oauth_failed/);
  await expect(page.getByText(/Couldn't finish signing in with Google/)).toBeVisible();
});

test("the callback never sends anyone off the site", async ({ page }) => {
  await page.goto("/auth/callback?code=x&next=https://evil.example");
  expect(page.url()).not.toContain("evil.example");
});
