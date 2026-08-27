import { describe, expect, it } from "vitest";
import {
  buildStudioPrompt,
  MAX_REFERENCES,
  type StudioBrand,
  type StudioToggles,
} from "@/server/services/ai/studio-prompt";

const ON: StudioToggles = { useColours: true, useTheme: true, useLogo: true };
const OFF: StudioToggles = { useColours: false, useTheme: false, useLogo: false };
const BRAND: StudioBrand = {
  palette: ["#0A2540", "#FF6B00"],
  themeNotes: "premium, minimal, warm daylight",
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
});
