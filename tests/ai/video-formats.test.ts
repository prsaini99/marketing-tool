import { describe, expect, it } from "vitest";
import {
  VIDEO_FORMATS,
  aspectForPlacement,
  getVideoFormat,
} from "@/server/services/ai/video-formats";
import { directionsFor } from "@/server/services/ai/art-directions";

describe("VIDEO_FORMATS", () => {
  it("ships the five formats the research found carry the feed", () => {
    expect(VIDEO_FORMATS.map((f) => f.id)).toEqual([
      "problem-hook",
      "transformation",
      "product-demo",
      "founder-story",
      "ugc-testimonial",
    ]);
  });

  it("gives every format a scene the video model can act on", () => {
    for (const f of VIDEO_FORMATS) {
      expect(f.scene.length, f.id).toBeGreaterThan(60);
      expect(f.anatomy.length, f.id).toBeGreaterThan(10);
      expect(f.briefExample.length, f.id).toBeGreaterThan(15);
      expect(f.failureMode.length, f.id).toBeGreaterThan(10);
    }
  });

  it("never asks the video model for on-screen text", () => {
    // Diffusion video renders text badly, and a misspelled headline burned
    // into a clip cannot be fixed without regenerating.
    for (const f of VIDEO_FORMATS) {
      expect(f.scene, f.id).not.toMatch(/headline|caption|on-screen text|subtitle/i);
    }
  });

  it("gives every format a look at least three art directions can serve", () => {
    for (const f of VIDEO_FORMATS) {
      expect(directionsFor(f.look).length, f.id).toBeGreaterThanOrEqual(3);
    }
  });

  it("finds a format by id and returns null for an unknown one", () => {
    expect(getVideoFormat("founder-story")?.name).toBe("Founder story");
    expect(getVideoFormat("nope")).toBeNull();
  });
});

describe("aspectForPlacement", () => {
  it("maps Stories and square straight through, with nothing to explain", () => {
    expect(aspectForPlacement("story")).toEqual({ aspectRatio: "9:16", note: null });
    expect(aspectForPlacement("feed-square")).toEqual({ aspectRatio: "1:1", note: null });
  });

  it("says so when 4:5 has no video equivalent", () => {
    // No text-to-video model offers 4:5. Squaring it silently would be worse.
    const r = aspectForPlacement("feed-portrait");
    expect(r.aspectRatio).toBe("1:1");
    expect(r.note).toMatch(/4:5/);
  });

  it("falls back to square for an unknown placement", () => {
    expect(aspectForPlacement("nope").aspectRatio).toBe("1:1");
  });
});
