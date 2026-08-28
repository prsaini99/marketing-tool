import { describe, expect, it } from "vitest";
import {
  buildStudioPrompt,
  MAX_REFERENCES,
  type StudioBrand,
  type StudioToggles,
} from "@/server/services/ai/studio-prompt";

const ON: StudioToggles = {
  useColours: true,
  useTheme: true,
  useLogo: true,
  useIdentity: true,
  useAvoid: true,
};
const OFF: StudioToggles = {
  useColours: false,
  useTheme: false,
  useLogo: false,
  useIdentity: false,
  useAvoid: false,
};
const BRAND: StudioBrand = {
  palette: ["#0A2540", "#FF6B00"],
  themeNotes: "premium, minimal, warm daylight",
  brandName: "Stackbinary",
  tagline: "Ship it already",
  avoidNotes: "stock-photo people, drop shadows",
};

describe("buildStudioPrompt", () => {
  it("always includes the brief", () => {
    expect(
      buildStudioPrompt({
        brief: "Diwali saree sale, 50% off",
        brand: null,
        toggles: OFF,
        roles: [],
      }),
    ).toContain("Diwali saree sale, 50% off");
  });

  it("includes palette colours when the colour toggle is on", () => {
    const p = buildStudioPrompt({ brief: "x", brand: BRAND, toggles: ON, roles: [] });
    expect(p).toContain("#0A2540");
    expect(p).toContain("#FF6B00");
  });

  it("omits palette entirely when the colour toggle is off", () => {
    const p = buildStudioPrompt({
      brief: "x",
      brand: BRAND,
      toggles: { ...ON, useColours: false },
      roles: [],
    });
    expect(p).not.toContain("#0A2540");
  });

  it("names the primary colour first", () => {
    const p = buildStudioPrompt({ brief: "x", brand: BRAND, toggles: ON, roles: [] });
    expect(p.indexOf("#0A2540")).toBeLessThan(p.indexOf("#FF6B00"));
  });

  it("includes theme notes only when the theme toggle is on", () => {
    expect(
      buildStudioPrompt({ brief: "x", brand: BRAND, toggles: ON, roles: [] }),
    ).toContain("premium, minimal");
    expect(
      buildStudioPrompt({
        brief: "x",
        brand: BRAND,
        toggles: { ...ON, useTheme: false },
        roles: [],
      }),
    ).not.toContain("premium, minimal");
  });

  it("treats a null brand as simply having nothing to add", () => {
    const p = buildStudioPrompt({ brief: "just a brief", brand: null, toggles: ON, roles: [] });
    expect(p).toContain("just a brief");
    expect(p).not.toContain("undefined");
    expect(p).not.toContain("null");
  });

  it("describes each reference role differently", () => {
    const p = buildStudioPrompt({
      brief: "x",
      brand: null,
      toggles: ON,
      roles: ["product", "style", "logo"],
    });
    // The three roles must produce three distinct instructions, or the model
    // cannot tell a product photo from a mood board.
    expect(p).toMatch(/product/i);
    expect(p).toMatch(/style|mood|aesthetic/i);
    expect(p).toMatch(/logo|brand mark/i);
  });

  it("says nothing about a logo when no logo reference is supplied", () => {
    const p = buildStudioPrompt({ brief: "x", brand: BRAND, toggles: ON, roles: ["product"] });
    expect(p).not.toMatch(/logo/i);
  });

  it("says nothing about a logo when the logo toggle is off", () => {
    const p = buildStudioPrompt({
      brief: "x",
      brand: BRAND,
      toggles: { ...ON, useLogo: false },
      roles: ["logo"],
    });
    expect(p).not.toMatch(/logo/i);
  });

  it("caps references at four in total", () => {
    expect(MAX_REFERENCES).toBe(4);
  });

  it("includes the brand name and tagline when the identity toggle is on", () => {
    const p = buildStudioPrompt({ brief: "x", brand: BRAND, toggles: ON, roles: [] });
    expect(p).toContain("Stackbinary");
    expect(p).toContain("Ship it already");
  });

  it("omits the brand name and tagline when the identity toggle is off", () => {
    const p = buildStudioPrompt({
      brief: "x",
      brand: BRAND,
      toggles: { ...ON, useIdentity: false },
      roles: [],
    });
    expect(p).not.toContain("Stackbinary");
    expect(p).not.toContain("Ship it already");
  });

  it("includes a brand name with no tagline without leaving a dangling fragment", () => {
    const brand: StudioBrand = { ...BRAND, tagline: null };
    const p = buildStudioPrompt({ brief: "x", brand, toggles: ON, roles: [] });
    expect(p).toContain("Stackbinary");
    expect(p).not.toContain("Ship it already");
    expect(p).not.toMatch(/tagline/i);
  });

  it("includes the do-not list as a negative instruction when its toggle is on", () => {
    const p = buildStudioPrompt({ brief: "x", brand: BRAND, toggles: ON, roles: [] });
    expect(p).toContain("stock-photo people, drop shadows");
    // It has to read as a prohibition, or the model treats it as a subject.
    expect(p).toMatch(/do not|avoid|never/i);
  });

  it("omits the do-not list when its toggle is off", () => {
    const p = buildStudioPrompt({
      brief: "x",
      brand: BRAND,
      toggles: { ...ON, useAvoid: false },
      roles: [],
    });
    expect(p).not.toContain("stock-photo people");
  });

  // NOTE: these last two pre-existing tests originally asserted exact string
  // equality (`toBe("just a brief")`) on the theory that a brief with no
  // brand content to add renders as nothing but the brief. That is no longer
  // achievable: this task makes UNIVERSAL_EXCLUSIONS unconditional (see the
  // "always excludes the universal failures" test below), which is the
  // explicit point of stating exclusions rather than leaving them implied.
  // The strength is preserved, not traded away: these now assert absence at
  // the section level (no BRAND: block, no sub-line for any blank field —
  // e.g. no "Brand theme notes:" with nothing after the colon, the real bug
  // this test was written for) instead of whole-string equality.
  it("treats blank identity fields as absent rather than rendering empty quotes", () => {
    const brand: StudioBrand = {
      palette: [],
      themeNotes: "   ",
      brandName: "   ",
      tagline: "",
      avoidNotes: "  ",
    };
    const p = buildStudioPrompt({ brief: "just a brief", brand, toggles: ON, roles: [] });
    expect(p).toContain("just a brief");
    expect(p).not.toContain('""');
    expect(p).not.toMatch(/undefined|null/);
    expect(p).not.toContain("BRAND:");
    expect(p).not.toContain("Brand theme notes:");
    expect(p).not.toContain("Render the brand name");
    expect(p).not.toContain("Include this tagline");
  });

  it("renders nothing from the identity fields when the brand is null", () => {
    const p = buildStudioPrompt({ brief: "just a brief", brand: null, toggles: ON, roles: [] });
    expect(p).toContain("just a brief");
    expect(p).not.toContain('""');
    expect(p).not.toMatch(/undefined|null/);
    expect(p).not.toContain("BRAND:");
    expect(p).not.toContain("Brand theme notes:");
    expect(p).not.toContain("Render the brand name");
    expect(p).not.toContain("Include this tagline");
  });

  it("quotes copy strings literally so the model renders them verbatim", () => {
    const p = buildStudioPrompt({
      brief: "",
      brand: null,
      toggles: OFF,
      roles: [],
      copy: { headline: "FLAT 50% OFF", cta: "SHOP NOW" },
    });
    expect(p).toContain('"FLAT 50% OFF"');
    expect(p).toContain('"SHOP NOW"');
  });

  it("labels each copy slot so the model knows which is which", () => {
    const p = buildStudioPrompt({
      brief: "",
      brand: null,
      toggles: OFF,
      roles: [],
      copy: { headline: "Big claim", cta: "Buy" },
    });
    expect(p).toMatch(/headline/i);
    expect(p).toMatch(/call to action|cta/i);
  });

  it("omits slots the copy does not carry", () => {
    const p = buildStudioPrompt({
      brief: "",
      brand: null,
      toggles: OFF,
      roles: [],
      copy: { headline: "Only this" },
    });
    expect(p).not.toMatch(/deadline|attribution|source/i);
  });

  it("includes the format layout instruction when one is given", () => {
    const p = buildStudioPrompt({
      brief: "x",
      brand: null,
      toggles: OFF,
      roles: [],
      layout: "Lay out as a four-panel checkerboard.",
    });
    expect(p).toContain("Lay out as a four-panel checkerboard.");
  });

  it("always states typography levels, since one-size text is the amateur tell", () => {
    const p = buildStudioPrompt({
      brief: "x",
      brand: null,
      toggles: OFF,
      roles: [],
      copy: { headline: "A", cta: "B" },
    });
    expect(p).toMatch(/TYPOGRAPHY/);
  });

  it("always excludes the universal failures even with no do-not list", () => {
    const p = buildStudioPrompt({ brief: "x", brand: null, toggles: OFF, roles: [] });
    expect(p).toMatch(/EXCLUDE/);
    expect(p).toMatch(/watermark/i);
    expect(p).toMatch(/gibberish|misspell/i);
  });

  it("folds the brand do-not list into the exclusions", () => {
    const p = buildStudioPrompt({
      brief: "x",
      brand: BRAND,
      toggles: ON,
      roles: [],
    });
    expect(p).toContain("stock-photo people, drop shadows");
    expect(p).toMatch(/EXCLUDE/);
  });

  it("renders as labelled sections rather than one paragraph", () => {
    const p = buildStudioPrompt({
      brief: "x",
      brand: BRAND,
      toggles: ON,
      roles: ["product"],
      layout: "Lay out as a stack.",
      copy: { headline: "H" },
    });
    for (const section of ["LAYOUT", "COPY", "TYPOGRAPHY", "BRAND", "REFERENCES", "EXCLUDE"]) {
      expect(p, section).toContain(section);
    }
  });
});
