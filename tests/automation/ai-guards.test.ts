/**
 * The output safety filter — the last thing standing between an LLM and a
 * public comment on a client's Page.
 *
 * Two classes of failure it exists to stop: the model inventing a URL
 * (sending customers somewhere the business doesn't control) and the model
 * inventing a price (a public quote the business must honour). Both are
 * checked against the business-authored profile corpus, never against the
 * model's own confidence.
 */

import { describe, expect, it } from "vitest";
import { isReplySafe } from "@/server/services/automation/ai-guards";
import type { ProfileCorpus } from "@/server/services/automation/ai-guards";

const profile: ProfileCorpus = {
  businessDescription: "We build websites. Our starter plan is Rs 500 per month.",
  toneRules: "Friendly",
  bannedTopics: ["refund policy"],
  links: { pricing: "https://example.com/pricing" },
  faqs: [{ question: "Do you ship?", answer: "Yes, delivery costs $20." }],
};

describe("isReplySafe — banned topics", () => {
  it("rejects a reply mentioning a banned topic", () => {
    expect(isReplySafe("Our refund policy is 30 days", profile)).toBe(false);
  });

  it("is case-insensitive about banned topics", () => {
    expect(isReplySafe("REFUND POLICY details here", profile)).toBe(false);
  });
});

describe("isReplySafe — URLs", () => {
  it("allows a URL from the profile link map", () => {
    expect(isReplySafe("See https://example.com/pricing", profile)).toBe(true);
  });

  it("rejects a URL that is not in the link map", () => {
    expect(isReplySafe("Check https://evil.example.net/deal", profile)).toBe(
      false,
    );
  });

  it("rejects scheme-less links", () => {
    // The filter is stricter than "starts with http" on purpose.
    expect(isReplySafe("message us on wa.me/123456", profile)).toBe(false);
    expect(isReplySafe("try bestdealz.com today", profile)).toBe(false);
  });

  it("ignores trailing punctuation when comparing URLs", () => {
    expect(isReplySafe("See https://example.com/pricing.", profile)).toBe(true);
  });

  it("does not treat ordinary prose as a bare domain", () => {
    // "Node.js" / "report.pdf" / "Mr.Patel" must not read as URLs.
    expect(isReplySafe("We use Node.js for this", profile)).toBe(true);
  });

  it("allows a reply with no links at all", () => {
    expect(isReplySafe("Happy to help — what are you building?", profile)).toBe(
      true,
    );
  });
});

describe("isReplySafe — prices", () => {
  it("allows a price that appears in the profile corpus", () => {
    expect(isReplySafe("The starter plan is Rs 500 per month", profile)).toBe(
      true,
    );
  });

  it("allows a price that appears in an FAQ answer", () => {
    // Regression: the corpus price ends a sentence, so PRICE_RE captures
    // "$20." while the reply yields "$20". Before normalizePrice stripped
    // trailing dots, exact membership failed and this legitimate reply was
    // suppressed as unsafe.
    expect(isReplySafe("Delivery costs $20", profile)).toBe(true);
  });

  it("still distinguishes a decimal price from its digit-fused twin", () => {
    // Stripping ALL dots would collapse "$20.50" to "$2050"; only trailing
    // dots may be stripped.
    const p = { ...profile, businessDescription: "Add-on is $2050 flat." };
    expect(isReplySafe("That is $20.50", p)).toBe(false);
  });

  it("rejects an invented price", () => {
    expect(isReplySafe("We can do it for Rs 300", profile)).toBe(false);
    expect(isReplySafe("That will be $99", profile)).toBe(false);
  });

  it("catches word-first currency, not just symbols", () => {
    expect(isReplySafe("Costs INR 2000", profile)).toBe(false);
  });

  it("normalises spacing and separators when comparing", () => {
    // "Rs 500" in the corpus should still authorise "Rs500".
    expect(isReplySafe("It is Rs500 monthly", profile)).toBe(true);
  });

  it("does not fuse digits across a sentence boundary into a fake price", () => {
    // Regression: substring matching once let "Rs 500" + " 1 day" authorise
    // a fabricated "Rs 5001". Membership is exact, so this must fail.
    expect(isReplySafe("Pay Rs 5001 now", profile)).toBe(false);
  });
});
