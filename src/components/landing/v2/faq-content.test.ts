import { describe, expect, it } from "vitest";
import { FAQ, faqJsonLd } from "./faq-content";

const all = FAQ.map((f) => `${f.question} ${f.answer}`).join("\n");
const answerTo = (q: RegExp) => FAQ.find((f) => q.test(f.question))!.answer;

describe("FAQ content", () => {
  it("has the spec's eight questions, each answered", () => {
    expect(FAQ).toHaveLength(8);
    for (const item of FAQ) {
      expect(item.question.trim()).not.toBe("");
      expect(item.answer.trim().length).toBeGreaterThan(20);
    }
  });
});

describe("claims ruled out by the facts", () => {
  // Each guard below is a decision, not a style preference. If one fails,
  // the fix is to go back to the facts -- not to loosen the test.

  it("never mentions CSV (not confirmed; the spec says XLSX only)", () => {
    expect(all).not.toMatch(/\bcsv\b/i);
  });

  it("never overstates edit history (each trade keeps its newest 50 versions)", () => {
    expect(all).not.toMatch(/every edit|full version history|all versions|unlimited history/i);
  });

  it("names XLSX, and only XLSX, as the export format", () => {
    const exports = answerTo(/export/i);
    expect(exports).toMatch(/XLSX/);
    expect(exports).not.toMatch(/\bjson\b|\bcsv\b|\bpdf\b/i);
  });

  it("names Interactive Brokers as the only confirmed broker, and only for stocks", () => {
    const brokers = answerTo(/broker/i);
    expect(brokers).toMatch(/Interactive Brokers/);
    expect(brokers).toMatch(/stocks/);
    for (const other of ["TD Ameritrade", "Schwab", "Fidelity", "Robinhood", "Webull", "tastytrade", "MetaTrader", "Binance", "Coinbase"]) {
      expect(all).not.toContain(other);
    }
  });

  it("never presents AI or MAE/MFE as free", () => {
    expect(answerTo(/train AI/i)).toMatch(/paid plan/);
    expect(answerTo(/really free/i)).toMatch(/MAE\/MFE[^.]*paid plan|paid plan[^.]*MAE\/MFE/);
  });

  it("names only the markets the facts list", () => {
    const markets = answerTo(/markets/i);
    expect(markets).toMatch(/Stocks and crypto/);
    expect(markets).not.toMatch(/forex|futures|options/i);
  });
});

describe("faqJsonLd", () => {
  it("is valid schema.org FAQPage structured data", () => {
    const ld = faqJsonLd();
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.mainEntity).toHaveLength(FAQ.length);
    for (const q of ld.mainEntity) {
      expect(q["@type"]).toBe("Question");
      expect(q.acceptedAnswer["@type"]).toBe("Answer");
    }
  });

  it("says exactly what the page shows, question for question", () => {
    const ld = faqJsonLd();
    ld.mainEntity.forEach((q, i) => {
      expect(q.name).toBe(FAQ[i].question);
      expect(q.acceptedAnswer.text).toBe(FAQ[i].answer);
    });
  });

  it("survives a JSON round trip unchanged, as it will in the page", () => {
    expect(JSON.parse(JSON.stringify(faqJsonLd()))).toEqual(faqJsonLd());
  });
});
