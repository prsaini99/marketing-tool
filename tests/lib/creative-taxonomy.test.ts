/**
 * The creative taxonomy is a closed vocabulary, and `coerceTags` is what
 * keeps it closed when the model misbehaves.
 *
 * The property that matters: a bad value must degrade to the escape hatch
 * ("other" / "unknown"), never propagate. One out-of-vocabulary label
 * written into Embedding.metadata becomes a permanent bucket of one in
 * every aggregate afterwards, and nothing in the UI would reveal where it
 * came from.
 */

import { describe, expect, it } from "vitest";
import {
  ANGLE_LABELS,
  buildClassifyPrompt,
  coerceTags,
  CREATIVE_ANGLES,
  CREATIVE_TAGS_SCHEMA,
  FUNNEL_STAGES,
  HOOK_LABELS,
  HOOK_TYPES,
  TAXONOMY_VERSION,
} from "@/lib/creative-taxonomy";

describe("taxonomy shape", () => {
  it("every hook type and angle has a UI label", () => {
    for (const h of HOOK_TYPES) expect(HOOK_LABELS[h], h).toBeTruthy();
    for (const a of CREATIVE_ANGLES) expect(ANGLE_LABELS[a], a).toBeTruthy();
  });

  it("has no label for a value outside the vocabulary", () => {
    expect(Object.keys(HOOK_LABELS).sort()).toEqual([...HOOK_TYPES].sort());
    expect(Object.keys(ANGLE_LABELS).sort()).toEqual([...CREATIVE_ANGLES].sort());
  });

  it("every dimension offers an escape value", () => {
    expect(HOOK_TYPES).toContain("other");
    expect(CREATIVE_ANGLES).toContain("other");
    expect(FUNNEL_STAGES).toContain("unknown");
  });

  it("the schema enums match the exported vocabularies", () => {
    const props = CREATIVE_TAGS_SCHEMA.properties.results.items.properties;
    expect(props.hookType.enum).toEqual([...HOOK_TYPES]);
    expect(props.angle.enum).toEqual([...CREATIVE_ANGLES]);
    expect(props.funnelStage.enum).toEqual([...FUNNEL_STAGES]);
  });
});

describe("coerceTags", () => {
  it("passes through valid values and stamps the version", () => {
    const t = coerceTags({
      hookType: "question",
      funnelStage: "TOFU",
      angle: "urgency",
      usp: "same-day delivery",
      persona: "small business owners",
    });
    expect(t).toEqual({
      hookType: "question",
      funnelStage: "TOFU",
      angle: "urgency",
      usp: "same-day delivery",
      persona: "small business owners",
      taxonomyVersion: TAXONOMY_VERSION,
    });
  });

  it("falls back for out-of-vocabulary labels rather than storing them", () => {
    const t = coerceTags({
      hookType: "URGENCY!!",
      funnelStage: "middle",
      angle: "vibes",
    });
    expect(t.hookType).toBe("other");
    expect(t.funnelStage).toBe("unknown");
    expect(t.angle).toBe("other");
  });

  it("is case-sensitive — a near-miss is still a miss", () => {
    // Deliberate: silently accepting "Question" would create two buckets
    // that look identical in the UI but never merge.
    expect(coerceTags({ hookType: "Question" }).hookType).toBe("other");
  });

  it("truncates free text to its word budget", () => {
    const t = coerceTags({
      usp: "one two three four five six seven eight nine ten",
      persona: "a b c d e f g h",
    });
    expect(t.usp.split(" ")).toHaveLength(8);
    expect(t.persona.split(" ")).toHaveLength(6);
  });

  it("returns empty strings for missing or non-string free text", () => {
    const t = coerceTags({ usp: 42, persona: null });
    expect(t.usp).toBe("");
    expect(t.persona).toBe("");
  });

  it("survives null, undefined and junk input", () => {
    for (const bad of [null, undefined, 0, "string", []]) {
      const t = coerceTags(bad);
      expect(t.hookType).toBe("other");
      expect(t.funnelStage).toBe("unknown");
      expect(t.taxonomyVersion).toBe(TAXONOMY_VERSION);
    }
  });

  it("trims surrounding whitespace from free text", () => {
    expect(coerceTags({ usp: "   fast shipping   " }).usp).toBe("fast shipping");
  });
});

describe("buildClassifyPrompt", () => {
  it("includes every creative's id and content", () => {
    const p = buildClassifyPrompt([
      { id: "c1", content: "Headline: Tired of slow sites?" },
      { id: "c2", content: "Headline: 40% off today" },
    ]);
    expect(p).toContain("c1");
    expect(p).toContain("c2");
    expect(p).toContain("Tired of slow sites?");
    expect(p).toContain("40% off today");
  });

  it("instructs the model to echo ids and never invent labels", () => {
    const p = buildClassifyPrompt([{ id: "c1", content: "x" }]);
    expect(p).toMatch(/echoing the given id/i);
    expect(p).toMatch(/never invent a label/i);
  });

  it("handles an empty batch without crashing", () => {
    expect(() => buildClassifyPrompt([])).not.toThrow();
  });
});
