import { describe, expect, it } from "vitest";
import {
  applyDisclosure,
  DEFAULT_BOT_DISCLOSURE,
  needsDisclosure,
} from "@/server/services/automation/disclosure";

const D = DEFAULT_BOT_DISCLOSURE;

describe("needsDisclosure", () => {
  it("discloses on the first private message of each DM action", () => {
    for (const action of ["DM", "AI_DM", "DM_VIA_COMMENT", "AI_DM_VIA_COMMENT"]) {
      expect(needsDisclosure(action, false)).toBe(true);
    }
  });

  it("stays quiet once the person has already been told", () => {
    for (const action of ["DM", "AI_DM", "DM_VIA_COMMENT", "AI_DM_VIA_COMMENT"]) {
      expect(needsDisclosure(action, true)).toBe(false);
    }
  });

  it("never touches public comment replies", () => {
    // A public reply is not a private automated conversation, and a
    // disclaimer under every comment would be noise on the Page.
    expect(needsDisclosure("PUBLIC_REPLY", false)).toBe(false);
    expect(needsDisclosure("AI_PUBLIC_REPLY", false)).toBe(false);
  });

  it("never touches a skipped action", () => {
    expect(needsDisclosure("SKIPPED", false)).toBe(false);
  });

  it("does not re-disclose to a repeat commenter", () => {
    // Same person, second comment, second comment-triggered DM. They were
    // told the first time, so this one stays clean.
    expect(needsDisclosure("DM_VIA_COMMENT", true)).toBe(false);
  });
});

describe("applyDisclosure", () => {
  it("appends after a blank line", () => {
    expect(applyDisclosure("Sure, it's 2000.", D)).toBe(
      `Sure, it's 2000.\n\n${D}`,
    );
  });

  it("does not double up when the text already ends with it", () => {
    const once = applyDisclosure("Hello.", D);
    expect(applyDisclosure(once, D)).toBe(once);
  });

  it("does not double up when a template embedded it mid-message", () => {
    const text = `${D} Anyway, our hours are 9 to 6.`;
    expect(applyDisclosure(text, D)).toBe(text);
  });

  it("matches a differently-cased copy", () => {
    const text = D.toUpperCase();
    expect(applyDisclosure(text, D)).toBe(text);
  });

  it("matches a copy that a template wrapped across lines", () => {
    // Whitespace is collapsed before comparing, so a hand-wrapped template
    // still counts as already disclosed.
    const wrapped = D.replace(" ", "\n  ");
    expect(applyDisclosure(wrapped, D)).toBe(wrapped);
  });

  it("trims trailing whitespace before appending, not leading", () => {
    expect(applyDisclosure("  Hi there.   ", D)).toBe(`  Hi there.\n\n${D}`);
  });

  it("returns the text untouched when the disclosure is blank", () => {
    expect(applyDisclosure("Hi.", "   ")).toBe("Hi.");
  });

  it("never turns an empty body into a bare disclaimer", () => {
    // orchestrate.ts skips empty text before this runs, but if that guard
    // ever moved, the failure must stay "nothing was sent" rather than a
    // customer receiving a disclaimer and no message.
    expect(applyDisclosure("", D)).toBe("");
    expect(applyDisclosure("   \n  ", D)).toBe("   \n  ");
  });
});

describe("the default wording", () => {
  it("names the opt-out keyword the engine actually honours", () => {
    // opt-out.ts matches on "stop". A disclosure advertising a different
    // keyword would be a promise the engine does not keep.
    expect(D.toLowerCase()).toContain("stop");
  });

  it("offers a route to a human", () => {
    expect(D.toLowerCase()).toContain("person");
  });

  it("carries no URL, so it can never trip the reply safety filter", () => {
    // isReplySafe rejects any reply containing a URL outside the profile's
    // link library. A disclosure with a link would block every first message.
    expect(D).not.toMatch(/https?:\/\/|\b[a-z0-9-]+\.[a-z]{2,}\b/i);
  });

  it("stays short enough not to dominate a ~60 word DM", () => {
    expect(D.split(/\s+/).length).toBeLessThanOrEqual(20);
  });
});
