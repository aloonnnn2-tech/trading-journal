import { afterEach, describe, expect, it, vi } from "vitest";
import { brevoSender } from "./send";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("brevoSender", () => {
  it("is not configured without BREVO_API_KEY", () => {
    vi.stubEnv("BREVO_API_KEY", "");
    expect(brevoSender()).toBeNull();
  });

  it("posts the email to Brevo from the support address", async () => {
    vi.stubEnv("BREVO_API_KEY", "key-123");
    vi.stubEnv("EMAIL_FROM", "");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const send = brevoSender(fetchMock as unknown as typeof fetch)!;
    await send({ to: "a@b.com", subject: "Hi", text: "Body", headers: { "List-Unsubscribe": "<x>" } });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("key-123");
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { name: "Trading Lenz", email: "tradinglenz@gmail.com" },
      replyTo: { email: "tradinglenz@gmail.com", name: "Trading Lenz" },
      to: [{ email: "a@b.com" }],
      subject: "Hi",
      textContent: "Body",
      headers: { "List-Unsubscribe": "<x>" },
    });
  });

  it("throws on a refused send, so the run undoes its record", async () => {
    vi.stubEnv("BREVO_API_KEY", "key-123");
    const fetchMock = vi.fn(async () => new Response('{"code":"unauthorized"}', { status: 401 }));
    const send = brevoSender(fetchMock as unknown as typeof fetch)!;
    await expect(send({ to: "a@b.com", subject: "Hi", text: "Body" })).rejects.toThrow("Brevo 401");
  });
});
