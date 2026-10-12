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
});
