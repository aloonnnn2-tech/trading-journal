import { describe, expect, it } from "vitest";
import { formatLogLine, redact } from "./log";

const parse = (line: string) => JSON.parse(line) as Record<string, unknown>;

describe("formatLogLine", () => {
  it("writes one JSON object with level, time, event and the request id", () => {
    const line = parse(formatLogLine("error", "images.upload_failed", { tradeId: "t1" }, "req-1", new Date("2026-10-16T12:00:00Z")));
    expect(line).toEqual({
      level: "error",
      time: "2026-10-16T12:00:00.000Z",
      event: "images.upload_failed",
      requestId: "req-1",
      tradeId: "t1",
    });
  });
});

describe("redact", () => {
  it("removes credentials by field name, whatever they look like", () => {
    expect(redact({ apiKey: "anything", authorization: "Bearer x", password: "p", access_token: "t" })).toEqual({
      apiKey: "[redacted]",
      authorization: "[redacted]",
      password: "[redacted]",
      access_token: "[redacted]",
    });
  });

  it("removes credentials and emails inside free text", () => {
    const out = redact({ error: "provider said: bad key sk-ant-abcdefghijklmnopqrstuv for alon@example.com" }) as {
      error: string;
    };
    expect(out.error).not.toContain("sk-ant-abcdefghijklmnopqrstuv");
    expect(out.error).not.toContain("alon@example.com");
    expect(out.error).toContain("[email]");
  });

  it("never logs what someone wrote in their journal", () => {
    expect(redact({ tradeId: "t1", notes: "sold too early again", custom_fields: { emotion: ["FOMO"] }, email: "a@b.co" })).toEqual({
      tradeId: "t1",
      notes: "[content]",
      custom_fields: "[content]",
      email: "[content]",
    });
  });

  it("reduces an error to name, message and code -- no stack, no attached request", () => {
    const err = Object.assign(new Error("duplicate key for bob@site.com"), { code: "23505", request: { headers: {} } });
    expect(redact(err)).toEqual({ name: "Error", message: "duplicate key for [email]", code: "23505" });
  });

  it("drops a database error's row details", () => {
    expect(redact({ error: { code: "23503", message: "fk violation", details: "Key (user_id)=(abc) is not present" } })).toEqual({
      error: { code: "23503", message: "fk violation", details: "[content]" },
    });
  });
});
