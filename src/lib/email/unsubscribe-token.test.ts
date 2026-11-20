import { describe, expect, it } from "vitest";
import { unsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from "./unsubscribe-token";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("unsubscribe token", () => {
  it("verifies for its own account only", () => {
    const t = unsubscribeToken(ID, "s3cret");
    expect(verifyUnsubscribeToken(ID, t, "s3cret")).toBe(true);
    expect(verifyUnsubscribeToken(OTHER, t, "s3cret")).toBe(false);
    expect(verifyUnsubscribeToken(ID, t, "other-secret")).toBe(false);
    expect(verifyUnsubscribeToken(ID, "", "s3cret")).toBe(false);
    expect(verifyUnsubscribeToken(ID, t, "")).toBe(false);
  });

  it("builds a link the page can read back", () => {
    const url = new URL(unsubscribeUrl(ID, "s3cret"));
    expect(url.pathname).toBe("/unsubscribe");
    expect(verifyUnsubscribeToken(url.searchParams.get("u")!, url.searchParams.get("t")!, "s3cret")).toBe(true);
  });
});
