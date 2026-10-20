import { describe, expect, it } from "vitest";
import { parseHelpRequest } from "./schema";
import { HONEYPOT_FIELD, MESSAGE_MAX } from "./config";

const good = { email: "a@example.com", topic: "account", message: "I can't sign in to my account." };

describe("parseHelpRequest", () => {
  it("accepts a normal request and cleans it", () => {
    const r = parseHelpRequest({ ...good, name: "  Ada \n  Lovelace ", page: "/sign-in" });
    expect(r).toEqual({
      kind: "store",
      data: { email: "a@example.com", name: "Ada Lovelace", topic: "account", message: good.message, page: "/sign-in", captchaToken: undefined },
    });
  });

  it("treats a filled honeypot as a bot, whatever else is in the request", () => {
    expect(parseHelpRequest({ ...good, [HONEYPOT_FIELD]: "http://spam.example" })).toEqual({ kind: "honeypot" });
    expect(parseHelpRequest({ [HONEYPOT_FIELD]: "x" })).toEqual({ kind: "honeypot" });
  });

  it("refuses bad or missing fields with a message for that field", () => {
    expect(parseHelpRequest({ ...good, email: "nope" })).toMatchObject({ kind: "invalid", message: expect.stringMatching(/email/) });
    expect(parseHelpRequest({ ...good, topic: "refund" })).toMatchObject({ kind: "invalid", message: expect.stringMatching(/about/) });
    expect(parseHelpRequest({ ...good, message: "hi" })).toMatchObject({ kind: "invalid", message: expect.stringMatching(/between/) });
    expect(parseHelpRequest({ ...good, message: "x".repeat(MESSAGE_MAX + 1) })).toMatchObject({ kind: "invalid" });
    expect(parseHelpRequest({ ...good, name: "n".repeat(81) })).toMatchObject({ kind: "invalid" });
    expect(parseHelpRequest(null)).toMatchObject({ kind: "invalid" });
    expect(parseHelpRequest([good])).toMatchObject({ kind: "invalid" });
  });

  it("strips control characters, but keeps line breaks in the message", () => {
    const r = parseHelpRequest({ ...good, message: "line one\nline two\u0000\u001b[31m red", name: "A\u0007B" });
    expect(r.kind).toBe("store");
    if (r.kind !== "store") return;
    expect(r.data.message).toBe("line one\nline two[31m red");
    expect(r.data.name).toBe("AB");
  });

  it("keeps only a path on this site as the page it came from", () => {
    for (const page of ["https://evil.example/x", "//evil.example", "javascript:alert(1)", "/a<b>"]) {
      const r = parseHelpRequest({ ...good, page });
      expect(r.kind === "store" && r.data.page, page).toBe(null);
    }
  });

  it("keeps markup in a message as text: the admin page shows it, never runs it", () => {
    const r = parseHelpRequest({ ...good, message: '<img src=x onerror="alert(1)"> help' });
    expect(r.kind === "store" && r.data.message).toBe('<img src=x onerror="alert(1)"> help');
  });
});
