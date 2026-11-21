import { afterEach, describe, expect, it, vi } from "vitest";
import { emailSender } from "./send";

afterEach(() => {
  vi.unstubAllEnvs();
});

function configure() {
  vi.stubEnv("GMAIL_SCRIPT_URL", "https://script.google.com/macros/s/abc/exec");
  vi.stubEnv("GMAIL_SCRIPT_SECRET", "shh");
}

describe("emailSender (Gmail Apps Script)", () => {
  it("is not configured without both variables", () => {
    vi.stubEnv("GMAIL_SCRIPT_URL", "https://script.google.com/macros/s/abc/exec");
    vi.stubEnv("GMAIL_SCRIPT_SECRET", "");
    expect(emailSender()).toBeNull();
  });

  it("posts the email and the shared secret to the script", async () => {
    configure();
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    await emailSender(fetchMock as unknown as typeof fetch)!({ to: "a@b.com", subject: "Hi", text: "Body" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://script.google.com/macros/s/abc/exec");
    expect(JSON.parse(init.body as string)).toEqual({ secret: "shh", to: "a@b.com", subject: "Hi", text: "Body" });
  });

  it("throws when the script refuses, so the run undoes its record", async () => {
    configure();
    const refused = vi.fn(async () => new Response('{"ok":false,"error":"unauthorized"}', { status: 200 }));
    await expect(
      emailSender(refused as unknown as typeof fetch)!({ to: "a@b.com", subject: "Hi", text: "Body" }),
    ).rejects.toThrow("unauthorized");
  });

  it("throws on a Google sign-in page instead of JSON", async () => {
    configure();
    const html = vi.fn(async () => new Response("<html>Sign in</html>", { status: 200 }));
    await expect(
      emailSender(html as unknown as typeof fetch)!({ to: "a@b.com", subject: "Hi", text: "Body" }),
    ).rejects.toThrow("Gmail script 200");
  });
});
