import { describe, expect, it } from "vitest";
import {
  ART_DIRECTIONS,
  artDirectionFor,
  directionsFor,
  type FormatLook,
} from "@/server/services/ai/art-directions";
import { AD_FORMATS } from "@/server/services/ai/ad-formats";

const LOOKS: FormatLook[] = ["designed", "photographic", "raw"];

describe("ART_DIRECTIONS", () => {
  it("has unique ids", () => {
    const ids = ART_DIRECTIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every direction a prompt fragment worth stating", () => {
    for (const d of ART_DIRECTIONS) {
      expect(d.direction.length, d.id).toBeGreaterThan(60);
      expect(d.direction, d.id).toMatch(/^Art direction:/);
      expect(d.suits.length, d.id).toBeGreaterThan(0);
    }
  });

  it("offers at least three choices for every look, or it would not vary", () => {
    // Two would alternate visibly; one would be no variation at all.
    for (const look of LOOKS) {
      expect(directionsFor(look).length, look).toBeGreaterThanOrEqual(3);
    }
  });

  it("never offers a designed treatment to a format that must look unstyled", () => {
    // A founder selfie shot as a "bold flat graphic" is not a founder selfie.
    for (const d of directionsFor("raw")) {
      expect(d.suits, d.id).toEqual(["raw"]);
    }
  });
});

describe("artDirectionFor", () => {
  it("returns a direction that suits the look", () => {
    for (const look of LOOKS) {
      for (let i = 0; i < 12; i++) {
        expect(artDirectionFor(look, i).suits, `${look}/${i}`).toContain(look);
      }
    }
  });

  it("wraps, so any index is valid", () => {
    const pool = directionsFor("designed");
    expect(artDirectionFor("designed", pool.length)).toEqual(
      artDirectionFor("designed", 0),
    );
    expect(artDirectionFor("designed", -1)).toEqual(
      artDirectionFor("designed", pool.length - 1),
    );
    expect(() => artDirectionFor("designed", 999999)).not.toThrow();
  });

  it("actually cycles rather than returning one direction", () => {
    // The whole point is that consecutive runs differ.
    const seen = new Set(
      Array.from({ length: 8 }, (_, i) => artDirectionFor("photographic", i).id),
    );
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});

describe("every format's look is servable", () => {
  it("gives each of the 17 formats at least three art directions", () => {
    for (const f of AD_FORMATS) {
      expect(directionsFor(f.look).length, f.id).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps formats whose layout is inherently unstyled on the raw look", () => {
    // These four describe a plain phone photo, a crude drawing, an organic
    // post and a founder snapshot; art-directing them defeats the format.
    const raw = AD_FORMATS.filter((f) => f.look === "raw").map((f) => f.id);
    expect(raw).toEqual(
      expect.arrayContaining([
        "sticky-note",
        "anti-ad",
        "platform-native",
        "founder-quote",
      ]),
    );
  });
});
