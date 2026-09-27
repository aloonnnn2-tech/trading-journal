import { describe, expect, it } from "vitest";
import { HONEYPOT_FIELD, MAX_EMAIL_LENGTH, parseWaitlistRequest } from "./validate";

const ok = { email: "trader@example.com", source: "home-paid-card" };

/** A VALID address exactly `length` characters long: a 64-character local
 *  part (the RFC maximum) and a domain built from labels of at most 63
 *  characters, so the only thing under test is the overall length. */
function addressOfLength(length: number): string {
  const local = "a".repeat(64);
  let domainBody = length - local.length - 1 - ".com".length; // chars before ".com"
  const labels: string[] = [];
  while (domainBody > 0) {
    // Leave room for the dot that joins the next label.
    const take = Math.min(63, domainBody);
    labels.push("b".repeat(take));
    domainBody -= take + 1;
  }
  // A final negative remainder means the last dot overshot by one: trim it back.
  let domain = labels.join(".") + ".com";
  const address = `${local}@${domain}`;
  if (address.length > length) domain = labels.join(".").slice(0, -1) + ".com";
  return `${local}@${domain}`;
}

describe("parseWaitlistRequest", () => {
  it("accepts a well-formed address from a known form", () => {
    expect(parseWaitlistRequest(ok)).toEqual({ kind: "store", email: "trader@example.com", source: "home-paid-card" });
  });

  it("trims whitespace around the address", () => {
    expect(parseWaitlistRequest({ ...ok, email: "  trader@example.com \n" })).toMatchObject({
      kind: "store",
      email: "trader@example.com",
    });
  });

  it("keeps the address's case; the database dedupes on lower(email)", () => {
    expect(parseWaitlistRequest({ ...ok, email: "Trader@Example.com" })).toMatchObject({ email: "Trader@Example.com" });
  });

  it(`accepts exactly ${MAX_EMAIL_LENGTH} characters and rejects ${MAX_EMAIL_LENGTH + 1}`, () => {
    // The spec's limit: "rejects over 254 characters".
    const atLimit = addressOfLength(MAX_EMAIL_LENGTH);
    const over = addressOfLength(MAX_EMAIL_LENGTH + 1);
    expect(atLimit).toHaveLength(MAX_EMAIL_LENGTH);
    expect(over).toHaveLength(MAX_EMAIL_LENGTH + 1);
    expect(parseWaitlistRequest({ ...ok, email: atLimit })).toEqual({ kind: "store", email: atLimit, source: "home-paid-card" });
    expect(parseWaitlistRequest({ ...ok, email: over })).toEqual({ kind: "invalid", reason: "email" });
  });

  it("rejects malformed addresses", () => {
    for (const email of ["", "   ", "not-an-email", "a@", "@b.com", "a b@c.com", "a@b"]) {
      expect(parseWaitlistRequest({ ...ok, email })).toEqual({ kind: "invalid", reason: "email" });
    }
  });

  it("rejects a missing or non-string address", () => {
    expect(parseWaitlistRequest({ source: "home-paid-card" })).toEqual({ kind: "invalid", reason: "email" });
    expect(parseWaitlistRequest({ ...ok, email: 42 })).toEqual({ kind: "invalid", reason: "email" });
  });

  it("rejects an unknown or missing source, so bots can't write free text", () => {
    expect(parseWaitlistRequest({ ...ok, source: "somewhere-else" })).toEqual({ kind: "invalid", reason: "source" });
    expect(parseWaitlistRequest({ email: ok.email })).toEqual({ kind: "invalid", reason: "source" });
  });

  it("treats a filled honeypot as a bot, whatever else is in the body", () => {
    expect(parseWaitlistRequest({ ...ok, [HONEYPOT_FIELD]: "https://spam.example" })).toEqual({ kind: "honeypot" });
    // Even with a bad email: the bot is still a bot, and still gets the quiet answer.
    expect(parseWaitlistRequest({ email: "junk", source: "x", [HONEYPOT_FIELD]: "x" })).toEqual({ kind: "honeypot" });
  });

  it("lets an empty or whitespace honeypot through, as a real form sends it", () => {
    expect(parseWaitlistRequest({ ...ok, [HONEYPOT_FIELD]: "" })).toMatchObject({ kind: "store" });
    expect(parseWaitlistRequest({ ...ok, [HONEYPOT_FIELD]: "   " })).toMatchObject({ kind: "store" });
  });

  it("rejects a body that isn't an object", () => {
    for (const body of [null, undefined, "x", 1, []]) {
      expect(parseWaitlistRequest(body)).toEqual({ kind: "invalid", reason: "body" });
    }
  });
});
