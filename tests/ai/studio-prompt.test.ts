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
    expect(buildStudioPrompt("Diwali saree sale, 50% off", null, OFF, [])).toContain(
      "Diwali saree sale, 50% off",
    );
  });

  it("includes palette colours when the colour toggle is on", () => {
    const p = buildStudioPrompt("x", BRAND, ON, []);
    expect(p).toContain("#0A2540");
    expect(p).toContain("#FF6B00");
  });

  it("omits palette entirely when the colour toggle is off", () => {
    const p = buildStudioPrompt("x", BRAND, { ...ON, useColours: false }, []);
    expect(p).not.toContain("#0A2540");
  });

  it("names the primary colour first", () => {
    const p = buildStudioPrompt("x", BRAND, ON, []);
    expect(p.indexOf("#0A2540")).toBeLessThan(p.indexOf("#FF6B00"));
  });

  it("includes theme notes only when the theme toggle is on", () => {
    expect(buildStudioPrompt("x", BRAND, ON, [])).toContain("premium, minimal");
    expect(
      buildStudioPrompt("x", BRAND, { ...ON, useTheme: false }, []),
    ).not.toContain("premium, minimal");
  });

  it("treats a null brand as simply having nothing to add", () => {
    const p = buildStudioPrompt("just a brief", null, ON, []);
    expect(p).toContain("just a brief");
    expect(p).not.toContain("undefined");
    expect(p).not.toContain("null");
  });

  it("describes each reference role differently", () => {
    const p = buildStudioPrompt("x", null, ON, ["product", "style", "logo"]);
    // The three roles must produce three distinct instructions, or the model
    // cannot tell a product photo from a mood board.
    expect(p).toMatch(/product/i);
    expect(p).toMatch(/style|mood|aesthetic/i);
    expect(p).toMatch(/logo|brand mark/i);
  });

  it("says nothing about a logo when no logo reference is supplied", () => {
    const p = buildStudioPrompt("x", BRAND, ON, ["product"]);
    expect(p).not.toMatch(/logo/i);
  });

  it("says nothing about a logo when the logo toggle is off", () => {
    const p = buildStudioPrompt("x", BRAND, { ...ON, useLogo: false }, ["logo"]);
    expect(p).not.toMatch(/logo/i);
  });

  it("caps references at four in total", () => {
    expect(MAX_REFERENCES).toBe(4);
  });

  it("includes the brand name and tagline when the identity toggle is on", () => {
    const p = buildStudioPrompt("x", BRAND, ON, []);
    expect(p).toContain("Stackbinary");
    expect(p).toContain("Ship it already");
  });

  it("omits the brand name and tagline when the identity toggle is off", () => {
    const p = buildStudioPrompt("x", BRAND, { ...ON, useIdentity: false }, []);
    expect(p).not.toContain("Stackbinary");
    expect(p).not.toContain("Ship it already");
  });

  it("includes a brand name with no tagline without leaving a dangling fragment", () => {
    const brand: StudioBrand = { ...BRAND, tagline: null };
    const p = buildStudioPrompt("x", brand, ON, []);
    expect(p).toContain("Stackbinary");
    expect(p).not.toContain("Ship it already");
    expect(p).not.toMatch(/tagline/i);
  });

  it("includes the do-not list as a negative instruction when its toggle is on", () => {
    const p = buildStudioPrompt("x", BRAND, ON, []);
    expect(p).toContain("stock-photo people, drop shadows");
    // It has to read as a prohibition, or the model treats it as a subject.
    expect(p).toMatch(/do not|avoid|never/i);
  });

  it("omits the do-not list when its toggle is off", () => {
    const p = buildStudioPrompt("x", BRAND, { ...ON, useAvoid: false }, []);
    expect(p).not.toContain("stock-photo people");
  });

  it("treats blank identity fields as absent rather than rendering empty quotes", () => {
    const brand: StudioBrand = {
      palette: [],
      themeNotes: "   ",
      brandName: "   ",
      tagline: "",
      avoidNotes: "  ",
    };
    const p = buildStudioPrompt("just a brief", brand, ON, []);
    expect(p).toBe("just a brief");
  });

  it("renders nothing from the identity fields when the brand is null", () => {
    const p = buildStudioPrompt("just a brief", null, ON, []);
    expect(p).toBe("just a brief");
  });
});
