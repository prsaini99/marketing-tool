/**
 * The guards that decide whether the bot speaks at all: opt-out detection,
 * the no-intent filter, template rendering, and human-attention flagging.
 *
 * These are the modules where a false negative sends spam and a false
 * positive silently swallows a real customer question — so the tests lean
 * on the exact edge cases their source comments call out.
 */

import { describe, expect, it } from "vitest";
import { isOptOutMessage } from "@/server/services/automation/opt-out";
import { hasIntent } from "@/server/services/automation/intent";
import { renderTemplate } from "@/server/services/automation/render";
import { pickFlagReason } from "@/server/services/automation/flags";

describe("isOptOutMessage", () => {
  it("matches bare opt-out keywords", () => {
    for (const t of ["stop", "STOP", "unsubscribe", "cancel!", "opt out", "opt-out", "leave me alone"]) {
      expect(isOptOutMessage(t), t).toBe(true);
    }
  });

  it("matches a polite prefix", () => {
    expect(isOptOutMessage("please stop")).toBe(true);
    expect(isOptOutMessage("please unsubscribe me")).toBe(true);
  });

  it("matches short phrases that begin with an opt-out keyword", () => {
    expect(isOptOutMessage("stop sending me messages")).toBe(true);
    expect(isOptOutMessage("stop texting me")).toBe(true);
  });

  it("does not match the keyword used mid-sentence", () => {
    expect(isOptOutMessage("don't stop the music")).toBe(false);
    expect(isOptOutMessage("I couldn't stop laughing at your reel yesterday")).toBe(
      false,
    );
  });

  it("does not match long messages that merely start with the word", () => {
    expect(
      isOptOutMessage("stop me if you have heard this one before my friend"),
    ).toBe(false);
  });

  it("does not match empty input", () => {
    expect(isOptOutMessage("")).toBe(false);
    expect(isOptOutMessage("   ")).toBe(false);
  });
});

describe("hasIntent", () => {
  it("is false for emoji-only messages", () => {
    expect(hasIntent("🔥🔥🔥")).toBe(false);
    expect(hasIntent("❤️")).toBe(false); // the U+FE0F case
    expect(hasIntent("👍🏽")).toBe(false); // skin-tone modifier
  });

  it("is false for a single filler word", () => {
    expect(hasIntent("nice")).toBe(false);
    expect(hasIntent("Congrats!")).toBe(false);
  });

  it("is false for empty or whitespace", () => {
    expect(hasIntent("")).toBe(false);
    expect(hasIntent("   ")).toBe(false);
  });

  it("is true for short real questions", () => {
    expect(hasIntent("How much?")).toBe(true);
  });

  it("is true when filler is followed by a real question", () => {
    expect(hasIntent("nice, can you build this?")).toBe(true);
  });

  it("is true for a digits-only message (phone number)", () => {
    // Regression: \p{Emoji} matches ASCII digits, which once stripped phone
    // numbers to zero tokens and silently suppressed them.
    expect(hasIntent("9876543210")).toBe(true);
  });

  it("is true for non-Latin scripts", () => {
    expect(hasIntent("कीमत क्या है")).toBe(true);
  });

  it("is true for a bare affirmation (may be a mid-thread reply)", () => {
    expect(hasIntent("yes")).toBe(true);
  });
});

describe("renderTemplate", () => {
  it("substitutes known variables", () => {
    const out = renderTemplate("Hi {username}!", { username: "asha" }, {});
    expect(out.text).toBe("Hi asha!");
    expect(out.missingKeys).toEqual([]);
  });

  it("resolves links from the profile link map", () => {
    const out = renderTemplate("See {link:pricing}", {}, {
      pricing: "https://example.com/pricing",
    });
    expect(out.text).toBe("See https://example.com/pricing");
    expect(out.missingKeys).toEqual([]);
  });

  it("renders unknown variables empty and reports them", () => {
    const out = renderTemplate("Hi {nope}", {}, {});
    expect(out.text).toBe("Hi");
    expect(out.missingKeys).toEqual(["nope"]);
  });

  it("reports unknown links with a link: prefix", () => {
    const out = renderTemplate("See {link:missing}", {}, {});
    expect(out.missingKeys).toEqual(["link:missing"]);
  });

  it("trims trailing whitespace before newlines", () => {
    const out = renderTemplate("a   \nb", {}, {});
    expect(out.text).toBe("a\nb");
  });

  it("a template of only a missing variable renders empty (engine then skips it)", () => {
    // decide.ts turns this into skipReason "empty_render" rather than
    // dispatching a blank message.
    expect(renderTemplate("{nope}", {}, {}).text).toBe("");
  });
});

describe("pickFlagReason", () => {
  const base = {
    aiEscalated: false,
    intentCategory: null,
    becameQualified: false,
    currentReason: null,
  };

  it("prioritises a stuck bot over a complaint", () => {
    expect(
      pickFlagReason({ ...base, aiEscalated: true, intentCategory: "COMPLAINT" }),
    ).toBe("ai_stuck");
  });

  it("prioritises a complaint over a qualified lead", () => {
    expect(
      pickFlagReason({
        ...base,
        intentCategory: "COMPLAINT",
        becameQualified: true,
      }),
    ).toBe("complaint");
  });

  it("flags a newly qualified lead", () => {
    expect(pickFlagReason({ ...base, becameQualified: true })).toBe("qualified");
  });

  it("returns null when nothing applies", () => {
    expect(pickFlagReason(base)).toBe(null);
  });

  it("does not re-flag a thread that already carries a reason", () => {
    // Re-flagging would reset flaggedAt and keep an unattended thread
    // permanently at the top of the queue.
    expect(
      pickFlagReason({ ...base, aiEscalated: true, currentReason: "qualified" }),
    ).toBe(null);
  });
});
