import { describe, expect, it } from "vitest";
import { nextNumberFieldState } from "./number-field-input";

describe("nextNumberFieldState", () => {
  it("clears to null on empty input", () => {
    expect(nextNumberFieldState("")).toEqual({ text: "", commit: true, value: null });
  });

  it("commits a plain positive integer", () => {
    expect(nextNumberFieldState("5")).toEqual({ text: "5", commit: true, value: 5 });
  });

  it("commits a plain decimal", () => {
    expect(nextNumberFieldState("5.25")).toEqual({ text: "5.25", commit: true, value: 5.25 });
  });

  it("holds display-only on a lone minus sign, without touching the stored value", () => {
    expect(nextNumberFieldState("-")).toEqual({ text: "-", commit: false, value: null });
  });

  it("holds display-only on a lone decimal point", () => {
    expect(nextNumberFieldState(".")).toEqual({ text: ".", commit: false, value: null });
  });

  it("holds display-only on a negative decimal point", () => {
    expect(nextNumberFieldState("-.")).toEqual({ text: "-.", commit: false, value: null });
  });

  it("commits a leading-decimal value once digits follow", () => {
    expect(nextNumberFieldState(".5")).toEqual({ text: ".5", commit: true, value: 0.5 });
  });

  it("commits a negative leading-decimal value", () => {
    expect(nextNumberFieldState("-.5")).toEqual({ text: "-.5", commit: true, value: -0.5 });
  });

  it("holds display-only on a trailing decimal point mid-edit", () => {
    expect(nextNumberFieldState("5.")).toEqual({ text: "5.", commit: false, value: null });
  });

  it("holds display-only on a negative number's trailing decimal point", () => {
    expect(nextNumberFieldState("-5.")).toEqual({ text: "-5.", commit: false, value: null });
  });

  it("commits once the trailing decimal gets a digit", () => {
    expect(nextNumberFieldState("-5.5")).toEqual({ text: "-5.5", commit: true, value: -5.5 });
  });

  it("tolerates leading zeros", () => {
    expect(nextNumberFieldState("05")).toEqual({ text: "05", commit: true, value: 5 });
  });

  it("rejects a second decimal point", () => {
    expect(nextNumberFieldState("5.5.5")).toBeNull();
  });

  it("rejects a second minus sign", () => {
    expect(nextNumberFieldState("--5")).toBeNull();
  });

  it("rejects a minus sign mid-string", () => {
    expect(nextNumberFieldState("5-5")).toBeNull();
  });

  it("rejects letters", () => {
    expect(nextNumberFieldState("5e5")).toBeNull();
  });

  it("rejects whitespace", () => {
    expect(nextNumberFieldState("5 5")).toBeNull();
  });
});
