import { describe, expect, it } from "vitest";
import { attributionFromVisit, attributionMetadata, cleanAttribution } from "./attribution";

const OWN = "tradinglenz.netlify.app";

describe("attributionFromVisit", () => {
  it("reads the UTM tags", () => {
    expect(attributionFromVisit("?utm_source=tiktok&utm_medium=bio&utm_campaign=launch", "", OWN)).toEqual({
      source: "tiktok",
      medium: "bio",
      campaign: "launch",
    });
  });

  it("keeps only the referring host, never the path or query", () => {
    expect(attributionFromVisit("", "https://www.reddit.com/r/swingtrading/comments/abc?x=secret", OWN)).toEqual({
      referrer: "reddit.com",
    });
  });

  it("does not count our own pages as a referral", () => {
    expect(attributionFromVisit("", `https://${OWN}/dashboard`, OWN)).toBeNull();
  });

  it("one spelling per source", () => {
    expect(attributionFromVisit("?utm_source=TikTok%20Bio", "", OWN)).toEqual({ source: "tiktok-bio" });
  });

  it("drops tags that are not plain", () => {
    expect(attributionFromVisit("?utm_source=%3Cscript%3E&utm_medium=" + "x".repeat(65), "", OWN)).toBeNull();
  });

  it("is null when there is nothing to say", () => {
    expect(attributionFromVisit("", "", OWN)).toBeNull();
    expect(attributionFromVisit("?ref=1", "not a url", OWN)).toBeNull();
  });
});

describe("cleanAttribution", () => {
  it("accepts what the browser stored", () => {
    expect(cleanAttribution({ source: "tiktok", referrer: "t.co" })).toEqual({ source: "tiktok", referrer: "t.co" });
  });

  it("drops anything else a request might carry", () => {
    expect(cleanAttribution({ source: "tiktok", email: "a@b.com", referrer: "https://x.com/a?b=c" })).toEqual({
      source: "tiktok",
      referrer: "x.com",
    });
    expect(cleanAttribution("tiktok")).toBeNull();
    expect(cleanAttribution(null)).toBeNull();
    expect(cleanAttribution({ source: 5 })).toBeNull();
  });
});

describe("attributionMetadata", () => {
  it("names the account keys, and adds none when there is no source", () => {
    expect(attributionMetadata({ source: "tiktok", campaign: "launch" })).toEqual({
      signup_source: "tiktok",
      signup_campaign: "launch",
    });
    expect(attributionMetadata(null)).toEqual({});
  });
});
