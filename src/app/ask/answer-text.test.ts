import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AnswerText } from "./answer-text";

// Renders to HTML so the assertions describe what the user actually sees.
function render(text: string): string {
  return renderToStaticMarkup(createElement(AnswerText, { text }));
}

describe("AnswerText formatting", () => {
  it("renders bold instead of showing asterisks", () => {
    // The bug this component exists to fix: every answer came back with
    // literal ** around the numbers.
    const html = render("Your **win rate** is 12.5%.");
    expect(html).toContain("<strong");
    expect(html).toContain("win rate");
    expect(html).not.toContain("**");
  });

  it("renders italic and inline code", () => {
    const html = render("That is *roughly* the `dollar_pl` column.");
    expect(html).toContain("<em>roughly</em>");
    expect(html).toContain("<code");
    expect(html).toContain("dollar_pl");
    expect(html).not.toContain("`");
  });

  it("does not mistake bold for two italics", () => {
    const html = render("**both sides**");
    expect(html).toContain("<strong");
    expect(html).not.toContain("<em>");
  });

  it("renders bullet lists", () => {
    const html = render("Findings:\n- DAL was best\n- CDNS was worst");
    expect(html).toContain("<ul");
    expect((html.match(/<li>/g) ?? []).length).toBe(2);
    expect(html).toContain("DAL was best");
  });

  it("renders numbered lists as an ordered list", () => {
    const html = render("1. First\n2. Second");
    expect(html).toContain("<ol");
    expect((html.match(/<li>/g) ?? []).length).toBe(2);
  });

  it("renders tables, dropping the separator row", () => {
    // Models emit these constantly; as plain text they were a wall of pipes.
    const html = render(
      "| Ticker | P&L |\n|--------|-----|\n| DAL | +$7.87 |\n| CDNS | -$11.23 |",
    );
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("Ticker");
    expect(html).toContain("DAL");
    // Two body rows, not three -- the |---| divider is layout, not data.
    expect((html.match(/<tr>/g) ?? []).length).toBe(3);
    expect(html).not.toContain("---");
  });

  it("keeps wide tables inside their own scroll container", () => {
    // Otherwise a wide table scrolls the whole page sideways on a phone.
    expect(render("| a | b |\n|---|---|\n| 1 | 2 |")).toContain("overflow-x-auto");
  });

  it("renders headings", () => {
    expect(render("## Best trade\ntext")).toContain("<h3");
  });

  it("keeps paragraphs separate", () => {
    const html = render("First para.\n\nSecond para.");
    expect((html.match(/<p /g) ?? []).length).toBe(2);
  });

  it("continues a list item across a wrapped line", () => {
    const html = render("- a finding that\n  wraps onto another line");
    expect((html.match(/<li>/g) ?? []).length).toBe(1);
    expect(html).toContain("wraps onto another line");
  });
});

describe("AnswerText safety", () => {
  // Provider output is untrusted text that has just been round-tripped
  // through a third party. It reaches the DOM here and nowhere else, so this
  // is the boundary that has to hold.
  it("escapes HTML rather than rendering it", () => {
    const html = render('<script>alert("xss")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes markup hidden inside formatting and tables", () => {
    const html = render("**<img src=x onerror=alert(1)>**\n\n| <b>h</b> |\n|---|\n| <i>c</i> |");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>h</b>");
    expect(html).not.toContain("<i>c</i>");
    expect(html).toContain("&lt;");
  });

  it("never turns a crafted link into a clickable one", () => {
    // This renderer produces no anchors at all, which is the simplest way to
    // guarantee a crafted href can never become clickable. The URL text still
    // appears -- as inert characters inside a paragraph, which is correct:
    // showing it is not the same as linking it, and silently deleting part of
    // an answer would be worse.
    const html = render("[click me](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href");
    expect(html).toContain("click me");
  });
});

describe("AnswerText resilience", () => {
  it("keeps unrecognized syntax as visible text rather than dropping it", () => {
    // Losing a line of an answer is worse than showing one with stray syntax.
    const html = render("~~struck~~ and > quoted");
    expect(html).toContain("struck");
    expect(html).toContain("quoted");
  });

  it("handles empty and whitespace-only answers without crashing", () => {
    expect(() => render("")).not.toThrow();
    expect(() => render("   \n\n  ")).not.toThrow();
  });

  it("handles an unterminated table row", () => {
    expect(() => render("| broken")).not.toThrow();
    expect(render("| broken")).toContain("broken");
  });
});
