import { describe, expect, it } from "vitest";
import {
  MAX_VIDEO_PROMPT,
  buildNegativePrompt,
  buildVideoPrompt,
  type VideoBrand,
  type VideoToggles,
} from "@/server/services/ai/video-prompt";

const ON: VideoToggles = {
  useColours: true,
  useTheme: true,
  useLogo: true,
  useIdentity: true,
  useAvoid: true,
};
const BRAND: VideoBrand = {
  palette: ["#0A2540", "#FF6B00"],
  themeNotes: "premium, minimal, warm daylight",
  brandName: "Kolam Oils",
  tagline: "Pressed the day you order",
  avoidNotes: "stock-photo people, drop shadows",
};
const SHOT = {
  subject: "a glass bottle of groundnut oil",
  action: "oil pouring slowly into a steel pan",
  camera: "slow push in, locked off",
  setting: "a sunlit home kitchen counter",
};

describe("buildVideoPrompt", () => {
  it("always includes the format's scene", () => {
    const p = buildVideoPrompt({
      brief: "x",
      scene: "One continuous take showing a change taking place.",
      brand: null,
      toggles: ON,
    });
    expect(p).toContain("One continuous take showing a change taking place.");
  });

  it("includes the brief", () => {
    const p = buildVideoPrompt({ brief: "Diwali gifting", scene: "s", brand: null, toggles: ON });
    expect(p).toContain("Diwali gifting");
  });

  it("renders every part of the shot", () => {
    const p = buildVideoPrompt({ brief: "x", scene: "s", brand: null, toggles: ON, shot: SHOT });
    for (const v of Object.values(SHOT)) expect(p).toContain(v);
  });

  it("NEVER asks for on-screen text, even with identity toggled on", () => {
    // The whole reason brandName and tagline are not passed to video.
    const p = buildVideoPrompt({ brief: "x", scene: "s", brand: BRAND, toggles: ON, shot: SHOT });
    expect(p).not.toContain("Kolam Oils");
    expect(p).not.toContain("Pressed the day you order");
    expect(p).not.toMatch(/headline|caption|on-screen text|render.*text/i);
  });

  it("includes palette and theme only when their toggles are on", () => {
    expect(buildVideoPrompt({ brief: "x", scene: "s", brand: BRAND, toggles: ON })).toContain("#0A2540");
    expect(
      buildVideoPrompt({ brief: "x", scene: "s", brand: BRAND, toggles: { ...ON, useColours: false } }),
    ).not.toContain("#0A2540");
    expect(buildVideoPrompt({ brief: "x", scene: "s", brand: BRAND, toggles: ON })).toContain("premium, minimal");
    expect(
      buildVideoPrompt({ brief: "x", scene: "s", brand: BRAND, toggles: { ...ON, useTheme: false } }),
    ).not.toContain("premium, minimal");
  });

  it("includes the art direction when given", () => {
    const p = buildVideoPrompt({
      brief: "x", scene: "s", brand: null, toggles: ON,
      artDirection: "Art direction: documentary candid.",
    });
    expect(p).toContain("Art direction: documentary candid.");
  });

  it("never renders null or undefined for an empty brand", () => {
    const p = buildVideoPrompt({ brief: "just a brief", scene: "s", brand: null, toggles: ON });
    expect(p).not.toMatch(/undefined|null/);
  });

  it("truncates at the vendor's cap on a sentence boundary", () => {
    // Kling rejects over 2500. Cutting mid-word sends the model half a
    // sentence; cutting at a full stop sends it a shorter brief.
    const long = "A very specific sentence about the product. ".repeat(200);
    const p = buildVideoPrompt({ brief: long, scene: "s", brand: null, toggles: ON });
    expect(p.length).toBeLessThanOrEqual(MAX_VIDEO_PROMPT);
    expect(p.trimEnd().endsWith(".")).toBe(true);
  });

  it("stays under the cap even when there is no sentence boundary to cut at", () => {
    // No full stop anywhere: truncate falls back to a raw slice. That is the
    // accepted fallback, but it must still respect the vendor's hard limit.
    const long = "a".repeat(9000);
    const p = buildVideoPrompt({ brief: long, scene: "s", brand: null, toggles: ON });
    expect(p.length).toBeLessThanOrEqual(MAX_VIDEO_PROMPT);
  });

  it("stays under the cap when the only full stop is near the start", () => {
    // Cutting there would throw away almost everything, so truncate keeps the
    // raw slice instead — still capped.
    const long = "Short. " + "a".repeat(9000);
    const p = buildVideoPrompt({ brief: long, scene: "s", brand: null, toggles: ON });
    expect(p.length).toBeLessThanOrEqual(MAX_VIDEO_PROMPT);
  });

  it("renders no shot fragment at all when every shot field is empty", () => {
    const p = buildVideoPrompt({
      brief: "x", scene: "s", brand: null, toggles: ON,
      shot: { subject: "", action: "", camera: "", setting: "" },
    });
    expect(p).not.toMatch(/Subject:|Action:|Camera:|Setting:/);
  });

  it("keeps a shot field whose own text ends in a colon and space", () => {
    const p = buildVideoPrompt({
      brief: "x", scene: "s", brand: null, toggles: ON,
      shot: { subject: "a sign that reads: ", action: "a", camera: "c", setting: "s" },
    });
    expect(p).toContain("a sign that reads:");
  });
});

describe("buildNegativePrompt", () => {
  it("always excludes the failures video models produce unprompted", () => {
    const n = buildNegativePrompt(null, ON);
    expect(n).toMatch(/text/i);
    expect(n).toMatch(/watermark/i);
    expect(n).toMatch(/distorted|deformed|extra limbs/i);
  });

  it("folds in the brand's do-not list when its toggle is on", () => {
    expect(buildNegativePrompt(BRAND, ON)).toContain("stock-photo people, drop shadows");
  });

  it("omits the do-not list when its toggle is off", () => {
    expect(buildNegativePrompt(BRAND, { ...ON, useAvoid: false })).not.toContain("stock-photo people");
  });

  it("is safe with no brand at all", () => {
    expect(buildNegativePrompt(null, ON).length).toBeGreaterThan(10);
  });
});
