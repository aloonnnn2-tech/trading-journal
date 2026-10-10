import { describe, expect, it } from "vitest";
import { accountGroup, maskEmail } from "./classify";

describe("accountGroup", () => {
  it("keeps the owner's accounts and the demo account, whatever the case", () => {
    expect(accountGroup("alonilon2018@gmail.com")).toBe("keep");
    expect(accountGroup("Aloonnnn2@Gmail.com")).toBe("keep");
    expect(accountGroup("demo@tradinglens.app")).toBe("keep");
  });

  it("only reserved test domains and the app's own domain are cleanup candidates", () => {
    expect(accountGroup("e2e-auth-1@tradinglens-e2e.invalid")).toBe("test");
    expect(accountGroup("demo+1712@caliunlock-demo.test")).toBe("test");
    expect(accountGroup("x@foo.example")).toBe("test");
    expect(accountGroup("x@box.localhost")).toBe("test");
    // The app's own domain: only verification scripts sign up there.
    expect(accountGroup("tour-check-1@tradinglens.app")).toBe("test");
    expect(accountGroup("demo-flow-yes@TradingLens.app")).toBe("test");
  });

  it("test-looking addresses on real domains go to a person, never auto-deleted", () => {
    expect(accountGroup("test123@gmail.com")).toBe("check");
    expect(accountGroup("someone@mailinator.com")).toBe("check");
    expect(accountGroup("x@example.com")).toBe("check");
    expect(accountGroup("")).toBe("check");
    expect(accountGroup(null)).toBe("check");
  });

  it("ordinary addresses are real users, including ones that merely contain 'test'", () => {
    expect(accountGroup("jane.doe@gmail.com")).toBe("real");
    expect(accountGroup("contest.winner@outlook.com")).toBe("real");
    expect(accountGroup("demonstrator@company.io")).toBe("real");
    expect(accountGroup("x@tradinglens.app.test.com")).toBe("real");
  });
});

describe("maskEmail", () => {
  it("keeps two letters and the domain", () => {
    expect(maskEmail("jane.doe@gmail.com")).toBe("ja***@gmail.com");
    expect(maskEmail("a@b.test")).toBe("a***@b.test");
    expect(maskEmail(null)).toBe("(no email)");
    expect(maskEmail("nodomain")).toBe("***");
  });
});
