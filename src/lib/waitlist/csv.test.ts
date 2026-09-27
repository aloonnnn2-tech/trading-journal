import { describe, expect, it } from "vitest";
import { csvField, waitlistToCsv } from "./csv";

describe("csvField", () => {
  it("leaves an ordinary address alone", () => {
    expect(csvField("trader@example.com")).toBe("trader@example.com");
  });

  it("renders a missing value as an empty field", () => {
    expect(csvField(null)).toBe("");
  });

  it("quotes a field containing a comma, a quote or a line break", () => {
    expect(csvField("a,b@example.com")).toBe('"a,b@example.com"');
    expect(csvField('say "hi"@example.com')).toBe('"say ""hi""@example.com"');
    expect(csvField("line\nbreak@example.com")).toBe('"line\nbreak@example.com"');
  });

  it("neutralises anything a spreadsheet would run as a formula", () => {
    // Visitor-typed addresses must never execute when the admin opens the file.
    for (const start of ["=", "+", "-", "@", "\t", "\r"]) {
      const field = csvField(`${start}cmd@example.com`);
      expect(field.replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvField("=HYPERLINK(\"http://evil\")")).toBe('"\'=HYPERLINK(""http://evil"")"');
  });

  it("does not touch those characters when they aren't first", () => {
    expect(csvField("a+b@example.com")).toBe("a+b@example.com");
    expect(csvField("first-last@example.com")).toBe("first-last@example.com");
  });
});

describe("waitlistToCsv", () => {
  it("writes a header and one CRLF-terminated line per signup", () => {
    const csv = waitlistToCsv([
      { email: "a@example.com", source: "home-paid-card", created_at: "2026-09-27T10:00:00+00:00" },
      { email: "b@example.com", source: null, created_at: "2026-09-27T11:00:00+00:00" },
    ]);
    expect(csv).toBe(
      "email,source,joined_at\r\n" +
        "a@example.com,home-paid-card,2026-09-27T10:00:00+00:00\r\n" +
        "b@example.com,,2026-09-27T11:00:00+00:00\r\n",
    );
  });

  it("writes just the header for an empty list", () => {
    expect(waitlistToCsv([])).toBe("email,source,joined_at\r\n");
  });
});
