import { describe, expect, it } from "vitest";
import { AD_FORMATS, getFormat } from "@/server/services/ai/ad-formats";

describe("AD_FORMATS", () => {
  it("ships seventeen formats", () => {
    expect(AD_FORMATS).toHaveLength(17);
  });

  it("has unique ids", () => {
    const ids = AD_FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every format a layout the image model can act on", () => {
    for (const f of AD_FORMATS) {
      // A layout shorter than this is a label, not an instruction.
      expect(f.layout.length, f.id).toBeGreaterThan(40);
      expect(f.anatomy.length, f.id).toBeGreaterThan(10);
      expect(f.failureMode.length, f.id).toBeGreaterThan(10);
      expect(f.defaultAngle.length, f.id).toBeGreaterThan(10);
    }
  });

  it("gives every format a concrete brief example", () => {
    // The placeholder is the one place the operator is told what a good
    // brief for this format looks like; an empty one invites an empty brief.
    for (const f of AD_FORMATS) {
      expect(f.briefExample.length, f.id).toBeGreaterThan(15);
      expect(f.briefExample, f.id).not.toMatch(/optional/i);
    }
  });

  it("gives every format at least one copy slot", () => {
    for (const f of AD_FORMATS) {
      expect(f.slots.length, f.id).toBeGreaterThan(0);
    }
  });

  it("gives every format a headline slot, since every ad needs a first line", () => {
    for (const f of AD_FORMATS) {
      expect(f.slots, f.id).toContain("headline");
    }
  });

  it("draws every frame block inside the 0-100 canvas", () => {
    for (const f of AD_FORMATS) {
      expect(f.frame.length, f.id).toBeGreaterThanOrEqual(2);
      for (const b of f.frame) {
        expect(b.x, f.id).toBeGreaterThanOrEqual(0);
        expect(b.y, f.id).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w, f.id).toBeLessThanOrEqual(100);
        expect(b.y + b.h, f.id).toBeLessThanOrEqual(100);
        expect(b.w, f.id).toBeGreaterThan(0);
        expect(b.h, f.id).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the cta slot and the cta block in step", () => {
    // Checked both ways: a block with no slot promises a button the copy
    // stage never fills, and a slot with no block generates CTA text the
    // image was never asked to draw.
    for (const f of AD_FORMATS) {
      const drawsCta = f.frame.some((b) => b.kind === "cta");
      const writesCta = f.slots.includes("cta");
      expect(drawsCta, `${f.id}: frame and slots disagree about a CTA`).toBe(writesCta);
    }
  });

  it("requires a reference for any format that shows real proof", () => {
    const proof = AD_FORMATS.filter((f) => f.needs === "proof").map((f) => f.id);
    expect(proof).toEqual(
      expect.arrayContaining([
        "before-after",
        "quote-card",
        "review-stack",
        "founder-quote",
      ]),
    );
  });

  it("never marks a proof format as satisfiable by a product photo", () => {
    // The catalogue is the contract both the studio and the generate route
    // read `needs` from, and both map "proof" to the proof reference role.
    // A format drifting to needs: "product" would let a staged product shot
    // stand in for a real customer, founder or result — the one thing the
    // design says must never be synthesised.
    const mustBeProof = [
      "before-after",
      "quote-card",
      "review-stack",
      "founder-quote",
    ];
    for (const id of mustBeProof) {
      expect(getFormat(id)?.needs, id).toBe("proof");
    }
  });

  it("only ever asks for one of the three known needs", () => {
    for (const f of AD_FORMATS) {
      expect(["none", "product", "proof"], f.id).toContain(f.needs);
    }
  });

  it("carries no invented figure in any frame label", () => {
    // review-stack once shipped label: "4.9 / 1,800" — an invented rating
    // sitting in the catalogue of the feature built to stop invented
    // figures, one render away from being drawn onto a published ad.
    for (const f of AD_FORMATS) {
      for (const b of f.frame) {
        expect(b.label ?? "", `${f.id}: frame label carries a figure`).not.toMatch(
          /[0-9]/,
        );
      }
    }
  });

  it("finds a format by id and returns null for an unknown one", () => {
    expect(getFormat("offer-stack")?.name).toBe("Offer stack");
    expect(getFormat("nope")).toBeNull();
  });
});
