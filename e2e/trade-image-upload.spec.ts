import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, signIn, type TestUser } from "./fixtures/test-user";

/**
 * Attaching a screenshot to a trade, through the real route and real dev
 * storage. Since 0073 users can't write to the bucket directly, so the route
 * uploads with the server's key (G-2) -- this pins that the normal path
 * still works end to end, and that the stored file is readable by its owner.
 */

let user: TestUser;
test.beforeAll(async () => {
  user = await createTestUser();
});
test.afterAll(async () => {
  await deleteTestUser(user.id);
});

test("a screenshot attached to a trade is stored and can be opened", async ({ page }) => {
  await signIn(page, user);
  const { id } = (await (await page.request.post("/api/trades")).json()) as { id: string };

  const png = fs.readFileSync(path.join(process.cwd(), "public", "brand-mark-128.png"));
  const res = await page.request.post(`/api/trades/${id}/images`, {
    multipart: { file: { name: "chart.png", mimeType: "image/png", buffer: png } },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { id: string; storage_path: string; url: string | null };
  expect(body.storage_path.startsWith(`${user.id}/${id}/`)).toBe(true);
  expect(body.url).toBeTruthy();

  const file = await page.request.get(body.url!);
  expect(file.status()).toBe(200);

  // And it can be removed again through the app.
  const removed = await page.request.delete(`/api/trades/${id}/images/${body.id}`);
  expect(removed.ok()).toBe(true);
});
