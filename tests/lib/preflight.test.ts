/**
 * Pre-flight scoring rules.
 *
 * The behaviour worth defending here is honesty about what was actually
 * checked: a skipped check must never quietly become a pass, and a hard
 * failure must never be averaged away by unrelated passes. Both mistakes
 * produce a number that looks trustworthy and isn't.
 */

import { describe, expect, it } from "vitest";
import {
  CHECK_WEIGHTS,
  checkFatigue,
  checkLink,
  checkPredictedPerformance,
  summarize,
  type PreflightCheck,
} from "@/lib/preflight";

const check = (over: Partial<PreflightCheck> = {}): PreflightCheck => ({
  id: "x",
  title: "X",
  status: "pass",
  detail: "",
  weight: 1,
  ...over,
});

describe("summarize", () => {
  it("scores all-pass as 100 and 'ready'", () => {
    const s = summarize([check(), check()]);
    expect(s.score).toBe(100);
    expect(s.verdict).toBe("ready");
    expect(s.checksRun).toBe(2);
  });

  it("excludes skipped checks from the score rather than counting them", () => {
    // Two passes and a skip must score the same as two passes.
    const withSkip = summarize([check(), check(), check({ status: "skipped" })]);
    expect(withSkip.score).toBe(100);
    expect(withSkip.checksRun).toBe(2);
    expect(withSkip.checksSkipped).toBe(1);
  });

  it("returns a null score when nothing could run", () => {
    const s = summarize([check({ status: "skipped" }), check({ status: "skipped" })]);
    expect(s.score).toBe(null);
    expect(s.checksRun).toBe(0);
    expect(s.headline).toMatch(/no checks/i);
  });

  it("any failure blocks, regardless of how high the average is", () => {
    // Three heavy passes plus one light fail still must not read as shippable.
    const s = summarize([
      check({ weight: 5 }),
      check({ weight: 5 }),
      check({ weight: 5 }),
      check({ status: "fail", weight: 1 }),
    ]);
    expect(s.verdict).toBe("blocked");
    expect(s.score).toBeGreaterThan(80); // the average alone would look fine
  });

  it("warns without blocking", () => {
    const s = summarize([check(), check({ status: "warn" })]);
    expect(s.verdict).toBe("review");
    expect(s.score).toBeLessThan(100);
    expect(s.score).toBeGreaterThan(0);
  });

  it("weights heavier checks more", () => {
    const policyFails = summarize([
      check({ status: "fail", weight: CHECK_WEIGHTS.policy }),
      check({ status: "pass", weight: CHECK_WEIGHTS.fatigue }),
    ]);
    const fatigueFails = summarize([
      check({ status: "pass", weight: CHECK_WEIGHTS.policy }),
      check({ status: "fail", weight: CHECK_WEIGHTS.fatigue }),
    ]);
    expect(policyFails.score!).toBeLessThan(fatigueFails.score!);
  });
});

describe("checkLink", () => {
  it("fails on a missing url", () => {
    expect(checkLink("").status).toBe("fail");
    expect(checkLink(null).status).toBe("fail");
    expect(checkLink(undefined).status).toBe("fail");
  });

  it("fails on an unparseable url", () => {
    expect(checkLink("not a url").status).toBe("fail");
    expect(checkLink("example.com/no-scheme").status).toBe("fail");
  });

  it("fails on a non-http protocol", () => {
    expect(checkLink("ftp://example.com").status).toBe("fail");
    expect(checkLink("javascript:alert(1)").status).toBe("fail");
  });

  it("warns on http", () => {
    expect(checkLink("http://example.com").status).toBe("warn");
  });

  it("warns on https without UTM tagging", () => {
    const r = checkLink("https://example.com/landing");
    expect(r.status).toBe("warn");
    expect(r.evidence?.join(" ")).toMatch(/utm_source/);
  });

  it("passes on https with UTM tagging", () => {
    expect(
      checkLink("https://example.com/landing?utm_source=meta").status,
    ).toBe("pass");
  });
});

describe("checkPredictedPerformance", () => {
  it("skips when no comparable has delivery data", () => {
    const r = checkPredictedPerformance([
      { cpaCents: null, spendCents: 0 },
      { cpaCents: 0, spendCents: 0 },
    ]);
    expect(r.status).toBe("skipped");
  });

  it("warns when the evidence is thin", () => {
    const r = checkPredictedPerformance([{ cpaCents: 40000, spendCents: 100000 }]);
    expect(r.status).toBe("warn");
    expect(r.detail).toMatch(/thin evidence/i);
  });

  it("agrees in number when describing how many comparables it found", () => {
    const one = checkPredictedPerformance([{ cpaCents: 100, spendCents: 500 }]);
    const two = checkPredictedPerformance([
      { cpaCents: 100, spendCents: 500 },
      { cpaCents: 200, spendCents: 500 },
    ]);
    expect(one.detail).toContain("1 comparable ad has");
    expect(two.detail).toContain("2 comparable ads have");
  });

  it("passes with enough comparables and reports a median", () => {
    const r = checkPredictedPerformance([
      { cpaCents: 30000, spendCents: 100000 },
      { cpaCents: 40000, spendCents: 100000 },
      { cpaCents: 50000, spendCents: 100000 },
    ]);
    expect(r.status).toBe("pass");
    expect(r.detail).toContain("400"); // median ₹400
  });

  it("respects the currency symbol", () => {
    const r = checkPredictedPerformance(
      [
        { cpaCents: 1000, spendCents: 5000 },
        { cpaCents: 2000, spendCents: 5000 },
        { cpaCents: 3000, spendCents: 5000 },
      ],
      "$",
    );
    expect(r.detail).toContain("$");
  });
});

describe("checkFatigue", () => {
  it("skips when the hook could not be classified", () => {
    expect(checkFatigue(null, 3, 10).status).toBe("skipped");
  });

  it("skips when the account has no active ads to compare against", () => {
    expect(checkFatigue("Question", 0, 0).status).toBe("skipped");
  });

  it("passes when the hook is unused", () => {
    const r = checkFatigue("Question", 0, 10);
    expect(r.status).toBe("pass");
    expect(r.detail).toMatch(/adds variety/i);
  });

  it("warns when the hook dominates the account", () => {
    const r = checkFatigue("Offer", 6, 10);
    expect(r.status).toBe("warn");
    expect(r.evidence?.join(" ")).toContain("6 of 10");
  });

  it("agrees in number and avoids a wrong indefinite article", () => {
    // Labels are data ("Offer", "Other", "How-to"), so any a/an rule would
    // eventually be wrong — the phrasing must not need one.
    const one = checkFatigue("Other", 1, 20);
    expect(one.evidence?.join(" ")).toContain("1 of 20 active ads already uses");
    const many = checkFatigue("Other", 3, 20);
    expect(many.evidence?.join(" ")).toContain("3 of 20 active ads already use");
    for (const r of [one, many, checkFatigue("Offer", 0, 5)]) {
      expect(r.detail, r.detail).not.toMatch(/\ba "(Other|Offer)"/);
    }
  });

  it("does not warn on a high share when the absolute count is small", () => {
    // 2 of 3 is a majority but not a fatigue problem.
    expect(checkFatigue("Offer", 2, 3).status).toBe("pass");
  });

  it("does not warn on a high count when the share is low", () => {
    expect(checkFatigue("Offer", 6, 40).status).toBe("pass");
  });
});
