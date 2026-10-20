import { describe, expect, it } from "vitest";
import { afterSignIn } from "./next-path";

describe("afterSignIn", () => {
  it("returns to the review page, and nowhere else it is told", () => {
    expect(afterSignIn("/review")).toBe("/review");
    expect(afterSignIn(null)).toBe("/dashboard");
    expect(afterSignIn("//evil.example")).toBe("/dashboard");
    expect(afterSignIn("https://evil.example/review")).toBe("/dashboard");
    expect(afterSignIn("/admin")).toBe("/dashboard");
  });

  it("returns to an emailed account-deletion link, exactly that shape", () => {
    const link = `/account/delete/confirm/${"a".repeat(43)}`;
    expect(afterSignIn(link)).toBe(link);
    expect(afterSignIn(`${link}?x=1`)).toBe("/dashboard");
    expect(afterSignIn(`${link}/more`)).toBe("/dashboard");
    expect(afterSignIn("/account/delete/confirm/short")).toBe("/dashboard");
    expect(afterSignIn(`//evil.example/account/delete/confirm/${"a".repeat(43)}`)).toBe("/dashboard");
    expect(afterSignIn("/account/delete/confirm")).toBe("/dashboard");
  });
});
