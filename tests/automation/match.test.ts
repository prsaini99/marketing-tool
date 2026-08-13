/**
 * Rule matching — the module that decides whether a stranger gets a DM.
 *
 * The behaviours locked in here are the ones with a spam incident behind
 * them: whole-word matching (substring matching once fired an "AI" rule on
 * "Airtel"), and the veto/no-match distinction that governs whether the AI
 * fallback is allowed to speak.
 */

import { describe, expect, it } from "vitest";
import {
  containsKeyword,
  matchRule,
  matchRuleWithReason,
  mediaScopeMatches,
} from "@/server/services/automation/match";
import type { IncomingEvent, RuleLike } from "@/server/services/automation/types";

function rule(over: Partial<RuleLike> = {}): RuleLike {
  return {
    id: "r1",
    priority: 10,
    enabled: true,
    triggerType: "COMMENT_KEYWORD",
    keywords: ["price"],
    negativeKeywords: [],
    mediaScope: "ALL",
    mediaId: null,
    ...over,
  } as RuleLike;
}

function comment(text: string, mediaId: string | null = "m1"): IncomingEvent {
  return { type: "COMMENT", text, mediaId } as IncomingEvent;
}

function dm(text: string): IncomingEvent {
  return { type: "MESSAGE", text, mediaId: null } as IncomingEvent;
}

describe("containsKeyword", () => {
  it("matches a standalone word case-insensitively", () => {
    expect(containsKeyword("what is the PRICE", "price")).toBe(true);
  });

  it("does not match inside a longer word", () => {
    // The incident that motivated whole-word matching.
    expect(containsKeyword("I use Airtel", "ai")).toBe(false);
    expect(containsKeyword("said again", "ai")).toBe(false);
  });

  it("still matches a standalone occurrence after an embedded one", () => {
    expect(containsKeyword("saidAI things about AI", "ai")).toBe(true);
  });

  it("treats punctuation and brackets as boundaries", () => {
    expect(containsKeyword("(AI)", "ai")).toBe(true);
    expect(containsKeyword("AI!", "ai")).toBe(true);
    expect(containsKeyword("what about AI, really", "ai")).toBe(true);
  });

  it("matches across non-Latin scripts where \\b would fail", () => {
    expect(containsKeyword("क्या AI काम करता है", "ai")).toBe(true);
  });

  it("supports multi-word and punctuated keywords", () => {
    expect(containsKeyword("can I book a demo tomorrow", "book a demo")).toBe(
      true,
    );
  });

  it("returns false for an empty or whitespace keyword", () => {
    expect(containsKeyword("anything", "")).toBe(false);
    expect(containsKeyword("anything", "   ")).toBe(false);
  });
});

describe("mediaScopeMatches", () => {
  const ads = new Set(["ad-media"]);

  it("SPECIFIC matches only the configured media", () => {
    const r = rule({ mediaScope: "SPECIFIC", mediaId: "m1" });
    expect(mediaScopeMatches(r, "m1", ads)).toBe(true);
    expect(mediaScopeMatches(r, "m2", ads)).toBe(false);
  });

  it("ADS matches only media in the ad set", () => {
    const r = rule({ mediaScope: "ADS" });
    expect(mediaScopeMatches(r, "ad-media", ads)).toBe(true);
    expect(mediaScopeMatches(r, "organic-media", ads)).toBe(false);
  });

  it("ORGANIC matches only media outside the ad set", () => {
    const r = rule({ mediaScope: "ORGANIC" });
    expect(mediaScopeMatches(r, "organic-media", ads)).toBe(true);
    expect(mediaScopeMatches(r, "ad-media", ads)).toBe(false);
  });

  it("an ADS rule does not fire when the ad list failed to load", () => {
    // Guessing here would fire an ads-only rule on organic posts.
    const r = rule({ mediaScope: "ADS" });
    expect(mediaScopeMatches(r, "m1", new Set())).toBe(false);
  });

  it("ALL honours a legacy mediaId as 'only this post'", () => {
    const r = rule({ mediaScope: "ALL", mediaId: "m1" });
    expect(mediaScopeMatches(r, "m1", ads)).toBe(true);
    expect(mediaScopeMatches(r, "m2", ads)).toBe(false);
  });
});

describe("matchRule", () => {
  it("returns the lowest-priority-number rule that matches", () => {
    const low = rule({ id: "low", priority: 1 });
    const high = rule({ id: "high", priority: 99 });
    expect(matchRule(comment("what price"), [high, low])?.id).toBe("low");
  });

  it("ignores disabled rules", () => {
    expect(matchRule(comment("what price"), [rule({ enabled: false })])).toBe(
      null,
    );
  });

  it("does not cross event types", () => {
    const commentRule = rule({ triggerType: "COMMENT_KEYWORD" });
    expect(matchRule(dm("what price"), [commentRule])).toBe(null);
  });

  it("_ANY rules match without keywords", () => {
    const any = rule({ triggerType: "COMMENT_ANY", keywords: [] });
    expect(matchRule(comment("literally anything"), [any])?.id).toBe("r1");
  });
});

describe("matchRuleWithReason", () => {
  it("reports a veto when a negative keyword suppresses the matching rule", () => {
    const r = rule({ negativeKeywords: ["free"] });
    const out = matchRuleWithReason(comment("what price, is it free?"), [r]);
    expect(out.rule).toBe(null);
    expect(out.vetoed).toBe(true);
  });

  it("does not report a veto when no rule was relevant anyway", () => {
    // A negative keyword on a rule whose trigger never matched must not
    // silence the AI fallback for an unrelated question.
    const r = rule({ keywords: ["demo"], negativeKeywords: ["not interested"] });
    const out = matchRuleWithReason(
      comment("not interested in the ad, but do you ship to Canada?"),
      [r],
    );
    expect(out.rule).toBe(null);
    expect(out.vetoed).toBe(false);
  });

  it("a vetoed high-priority rule still lets a lower-priority rule match", () => {
    const vetoed = rule({ id: "vetoed", priority: 1, negativeKeywords: ["free"] });
    const catchAll = rule({
      id: "catchall",
      priority: 50,
      triggerType: "COMMENT_ANY",
      keywords: [],
    });
    const out = matchRuleWithReason(comment("price? is it free"), [
      vetoed,
      catchAll,
    ]);
    expect(out.rule?.id).toBe("catchall");
    expect(out.vetoed).toBe(false);
  });
});
