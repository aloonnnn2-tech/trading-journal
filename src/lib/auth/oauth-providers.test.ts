import { describe, expect, it } from "vitest";
import { enabledProviders } from "./oauth-providers";

describe("enabledProviders", () => {
  it("offers Google once Supabase has it switched on", () => {
    expect(enabledProviders({ external: { email: true, google: true } })).toEqual(["google"]);
  });

  it("offers nothing while it is off", () => {
    expect(enabledProviders({ external: { email: true, google: false } })).toEqual([]);
  });

  it("ignores providers this app has no button for", () => {
    expect(enabledProviders({ external: { github: true } })).toEqual([]);
  });

  it("offers nothing when the settings can't be read", () => {
    expect(enabledProviders(null)).toEqual([]);
    expect(enabledProviders({})).toEqual([]);
    expect(enabledProviders("oops")).toEqual([]);
  });
});
