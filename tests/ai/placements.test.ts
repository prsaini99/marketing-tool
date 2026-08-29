import { describe, expect, it } from "vitest";
import {
  PLACEMENTS,
  getPlacement,
  resolveSize,
  supportsExactRatio,
} from "@/server/services/ai/placements";

/** "1024x1280" -> 1024 / 1280 */
function ratioOf(size: string): number {
  const [w, h] = size.split("x").map(Number);
  return w / h;
}

function dims(size: string): [number, number] {
  const [w, h] = size.split("x").map(Number);
  return [w, h];
}

describe("PLACEMENTS", () => {
  it("offers the three placements Meta actually delivers to", () => {
    expect(PLACEMENTS.map((p) => p.id)).toEqual([
      "feed-square",
      "feed-portrait",
      "story",
    ]);
  });

  it("keeps every exact size within gpt-image-2's stated constraints", () => {
    // Both edges divisible by 16, ratio between 1:3 and 3:1. A size that
    // breaks either is a 400 mid-generation rather than a fallback.
    for (const p of PLACEMENTS) {
      const [w, h] = dims(p.exactSize);
      expect(w % 16, `${p.id} width`).toBe(0);
      expect(h % 16, `${p.id} height`).toBe(0);
      const r = w / h;
      expect(r, `${p.id} ratio`).toBeGreaterThanOrEqual(1 / 3);
      expect(r, `${p.id} ratio`).toBeLessThanOrEqual(3);
    }
  });

  it("hits the true ratio for each placement", () => {
    expect(ratioOf(getPlacement("feed-square")!.exactSize)).toBeCloseTo(1, 4);
    expect(ratioOf(getPlacement("feed-portrait")!.exactSize)).toBeCloseTo(0.8, 4);
    expect(ratioOf(getPlacement("story")!.exactSize)).toBeCloseTo(0.5625, 4);
  });

  it("only uses sizes the standard models accept as fallbacks", () => {
    const STANDARD = new Set(["1024x1024", "1024x1536", "1536x1024"]);
    for (const p of PLACEMENTS) {
      expect(STANDARD.has(p.fallbackSize), `${p.id}: ${p.fallbackSize}`).toBe(true);
    }
  });

  it("marks a fallback exact only when it really is the same shape", () => {
    for (const p of PLACEMENTS) {
      const same =
        Math.abs(ratioOf(p.fallbackSize) - ratioOf(p.exactSize)) < 0.001;
      expect(p.fallbackIsExact, p.id).toBe(same);
    }
  });

  it("tells the model about the Stories safe zone, and only there", () => {
    // The 9:16 safe zone is the one placement where Meta's own interface
    // covers part of the frame; repeating it elsewhere is noise.
    expect(getPlacement("story")!.promptNote).toMatch(/14%/);
    expect(getPlacement("story")!.promptNote).toMatch(/6%/);
    expect(getPlacement("feed-square")!.promptNote).not.toMatch(/14%/);
    expect(getPlacement("feed-portrait")!.promptNote).not.toMatch(/14%/);
  });

  it("finds a placement by id and returns null for an unknown one", () => {
    expect(getPlacement("story")?.ratio).toBe("9:16");
    expect(getPlacement("nope")).toBeNull();
  });
});

describe("supportsExactRatio", () => {
  it("is true only for models that accept arbitrary resolutions", () => {
    expect(supportsExactRatio("gpt-image-2")).toBe(true);
    expect(supportsExactRatio("gpt-image-1.5")).toBe(false);
    expect(supportsExactRatio("gpt-image-1")).toBe(false);
    expect(supportsExactRatio("chatgpt-image-latest")).toBe(false);
  });

  it("tolerates surrounding whitespace, since the model arrives from a form", () => {
    expect(supportsExactRatio("  gpt-image-2 ")).toBe(true);
  });
});

describe("resolveSize", () => {
  it("gives the exact size on a model that supports it", () => {
    const r = resolveSize(getPlacement("feed-portrait")!, "gpt-image-2");
    expect(r).toEqual({ size: "1024x1280", exact: true });
  });

  it("falls back to the nearest standard size elsewhere, and says it is not exact", () => {
    const r = resolveSize(getPlacement("feed-portrait")!, "gpt-image-1.5");
    expect(r).toEqual({ size: "1024x1536", exact: false });
  });

  it("reports square as exact on every model, because it genuinely is", () => {
    for (const model of ["gpt-image-2", "gpt-image-1.5", "gpt-image-1"]) {
      expect(resolveSize(getPlacement("feed-square")!, model), model).toEqual({
        size: "1024x1024",
        exact: true,
      });
    }
  });

  it("never returns a size outside what the chosen model accepts", () => {
    const STANDARD = new Set(["1024x1024", "1024x1536", "1536x1024"]);
    for (const p of PLACEMENTS) {
      const { size } = resolveSize(p, "gpt-image-1.5");
      expect(STANDARD.has(size), `${p.id} on a standard-size model`).toBe(true);
    }
  });
});
