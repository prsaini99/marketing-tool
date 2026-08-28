import { describe, expect, it } from "vitest";
import { extractFigures, findFabricated } from "@/server/services/ai/copy-guard";

describe("extractFigures", () => {
  it("pulls plain numbers", () => {
    expect(extractFigures("Save 20 minutes a day")).toContain("20");
  });

  it("pulls percentages", () => {
    expect(extractFigures("FLAT 50% OFF")).toContain("50");
  });

  it("normalises currency and separators so ₹1,000 matches 1000", () => {
    expect(extractFigures("₹1,000 off")).toEqual(extractFigures("1000 off"));
  });

  it("ignores years and ordinals that are not claims", () => {
    // A model writing "since 2019" is not inventing a price.
    expect(extractFigures("Trusted since 2019")).toEqual([]);
  });

  it("still ignores a four-digit run with a year cue beside it", () => {
    expect(extractFigures("Trusted since 2019")).toEqual([]);
    expect(extractFigures("© 2024 Acme")).toEqual([]);
    expect(extractFigures("Est. 1998, still here")).toEqual([]);
    expect(extractFigures("In 2020 we started")).toEqual([]);
    expect(extractFigures("Serving India from 2015")).toEqual([]);
    expect(extractFigures("2019-2024 in review")).not.toContain("2019");
  });

  it("does NOT exempt a four-digit price just because it falls in the year range", () => {
    // The Indian price band is 1,499 / 1,999 / 2,999 — the old range-only
    // exemption let every one of them through as an invented figure.
    expect(extractFigures("FLAT ₹1,999 OFF")).toContain("1999");
    expect(extractFigures("Save ₹2000 today")).toContain("2000");
    expect(extractFigures("Rs 1999 only")).toContain("1999");
    expect(extractFigures("Just $2000")).toContain("2000");
  });

  it("does NOT exempt a four-digit count or percentage with no year cue", () => {
    expect(extractFigures("1,999 happy customers")).toContain("1999");
    expect(extractFigures("2000% more comfortable")).toContain("2000");
    expect(extractFigures("1999 off your first order")).toContain("1999");
  });

  it("returns nothing for text with no figures", () => {
    expect(extractFigures("Built to last")).toEqual([]);
  });

  it("does not fuse comma-separated figures with no word between them", () => {
    // The regex admits a comma only when a digit follows immediately, so a
    // comma-space is a list separator and not number grouping.
    expect(extractFigures("10, 20 items available")).toEqual(["10", "20"]);
    expect(extractFigures("3, 4")).toEqual(["3", "4"]);
  });

  it("keeps comma grouping inside a single number", () => {
    expect(extractFigures("₹1,000")).toEqual(["1000"]);
    expect(extractFigures("₹1,00,000")).toEqual(["100000"]);
  });

  it("does not absorb a sentence-ending period into a figure", () => {
    expect(extractFigures("Save 50%. Now.")).toEqual(["50"]);
  });

  it("expands Indian magnitude suffixes so both notations match", () => {
    expect(extractFigures("₹1.5L off")).toContain("150000");
    expect(extractFigures("₹1.5L off")).toContain("1.5");
  });

  it("does not read a unit as a magnitude suffix", () => {
    expect(extractFigures("1.5 litres")).toEqual(["1.5"]);
    expect(extractFigures("2 kg")).toEqual(["2"]);
  });
});

describe("findFabricated", () => {
  it("flags a figure that appears nowhere in the sources", () => {
    expect(findFabricated(["FLAT 50% OFF"], ["Diwali sale on now"])).toEqual(["50"]);
  });

  it("flags an invented four-digit price, discount or review count", () => {
    // Each of these passed unflagged while the year exemption was a bare
    // range test — an invented price, an invented offer and an invented
    // review count, all drawn straight onto a published ad.
    expect(findFabricated(["FLAT ₹1,999 OFF"], ["Diwali sale on now"])).toEqual(["1999"]);
    expect(findFabricated(["Save ₹2000 today"], ["Diwali sale on now"])).toEqual(["2000"]);
    expect(findFabricated(["1,999 happy customers"], ["Diwali sale on now"])).toEqual(["1999"]);
  });

  it("still lets a genuine year through untouched", () => {
    expect(findFabricated(["Trusted since 2019"], ["A brand with no dates"])).toEqual([]);
    expect(findFabricated(["© 2024 Acme"], ["A brand with no dates"])).toEqual([]);
  });

  it("allows a four-digit price the brief actually supplied", () => {
    expect(findFabricated(["FLAT ₹1,999 OFF"], ["priced at 1999 this week"])).toEqual([]);
  });

  it("allows a figure the brief actually supplied", () => {
    expect(findFabricated(["FLAT 50% OFF"], ["50% off for Diwali"])).toEqual([]);
  });

  it("allows a figure written differently from its source", () => {
    expect(findFabricated(["Save ₹1,000"], ["1000 rupees off"])).toEqual([]);
  });

  it("checks every copy string, not just the first", () => {
    expect(findFabricated(["Real deal", "4.9 stars"], ["Real deal"])).toEqual(["4.9"]);
  });

  it("passes cleanly when the copy carries no figures at all", () => {
    expect(findFabricated(["Built to last", "Shop now"], [])).toEqual([]);
  });

  it("does not fuse adjacent unrelated numbers into one figure", () => {
    // The exact failure isReplySafe was written to avoid.
    expect(findFabricated(["2 sizes, 3 colours"], ["2 sizes and 3 colours"])).toEqual([]);
  });

  it("expands Indian magnitude suffixes so both notations match", () => {
    expect(findFabricated(["Save ₹150000"], ["1.5L off this week"])).toEqual([]);
    expect(findFabricated(["Save ₹1.5L"], ["150000 off this week"])).toEqual([]);
  });

  it("does not let an unrelated source figure vouch for a fabricated one", () => {
    // The reduce-any-figure heuristic this replaced cleared "1.5" because an
    // unrelated "1500" divided down to it.
    expect(
      findFabricated(["Now 1.5x more powerful"], ["Ships within 1500 units in stock"]),
    ).toEqual(["1.5"]);
  });
});
