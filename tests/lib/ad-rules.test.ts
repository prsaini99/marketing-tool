/**
 * Automated rule evaluation.
 *
 * This is the one place in the product where software pauses a client's ads
 * without a person present, so these tests are less about coverage and more
 * about pinning the specific ways this could go wrong with real money:
 * acting on noise, acting on a stalled sync, acting repeatedly, and — the
 * subtlest — treating "no conversions" as "a CPA of zero".
 */

import { describe, expect, it } from "vitest";
import {
  computeMetric,
  describeRule,
  evaluateRule,
  formatMetric,
  isInCooldown,
  type MetricsWindow,
  type RuleLike,
} from "@/lib/ad-rules";

const NOW = new Date("2026-08-12T10:00:00Z");

const rule = (over: Partial<RuleLike> = {}): RuleLike => ({
  id: "r1",
  enabled: true,
  metric: "cpa",
  operator: "gt",
  threshold: 50_000, // ₹500
  windowDays: 3,
  minSpendCents: 100_000, // ₹1,000
  action: "pause",
  cooldownHours: 24,
  lastFiredAt: null,
  ...over,
});

const metrics = (over: Partial<MetricsWindow> = {}): MetricsWindow => ({
  spendCents: 300_000,
  impressions: 10_000,
  clicks: 200,
  conversions: 4,
  revenueCents: 600_000,
  daysWithData: 3,
  ...over,
});

describe("computeMetric", () => {
  it("computes each metric in its own unit", () => {
    const m = metrics();
    expect(computeMetric("spend", m)).toBe(300_000);
    expect(computeMetric("cpa", m)).toBe(75_000); // 300000 / 4
    expect(computeMetric("roas", m)).toBe(2); // 600000 / 300000
    expect(computeMetric("ctr", m)).toBe(0.02); // 200 / 10000
  });

  it("returns null — never zero — when a metric is undefined", () => {
    // The load-bearing case: no conversions means CPA is unknown, not 0.
    expect(computeMetric("cpa", metrics({ conversions: 0 }))).toBe(null);
    expect(computeMetric("roas", metrics({ spendCents: 0 }))).toBe(null);
    expect(computeMetric("ctr", metrics({ impressions: 0 }))).toBe(null);
  });
});

describe("evaluateRule — guards", () => {
  it("does not act below the spend floor", () => {
    const e = evaluateRule(rule(), metrics({ spendCents: 50_000 }), NOW);
    expect(e.fires).toBe(false);
    expect(e.skipReason).toBe("below_min_spend");
    expect(e.explanation).toMatch(/too early to judge/i);
  });

  it("does not act when the window is only partly synced", () => {
    // 1 of 3 days — a stalled sync must not read as a collapse.
    const e = evaluateRule(rule({ windowDays: 3 }), metrics({ daysWithData: 1 }), NOW);
    expect(e.fires).toBe(false);
    expect(e.skipReason).toBe("insufficient_data");
    expect(e.explanation).toMatch(/insights may be behind/i);
  });

  it("accepts a window with two-thirds coverage", () => {
    const e = evaluateRule(rule({ windowDays: 3 }), metrics({ daysWithData: 2 }), NOW);
    expect(e.skipReason).not.toBe("insufficient_data");
  });

  it("never fires a cpa rule when there were no conversions", () => {
    // If CPA were treated as 0, a "cpa < X" rule would fire on every entity
    // that converted nobody — exactly backwards.
    const e = evaluateRule(
      rule({ operator: "lt", threshold: 50_000 }),
      metrics({ conversions: 0 }),
      NOW,
    );
    expect(e.fires).toBe(false);
    expect(e.skipReason).toBe("metric_undefined");
    expect(e.explanation).toMatch(/not treated as zero/i);
  });

  it("suppresses a repeat inside the cooldown but still reports what it saw", () => {
    const e = evaluateRule(
      rule({ lastFiredAt: new Date("2026-08-12T02:00:00Z") }), // 8h ago
      metrics(),
      NOW,
    );
    expect(e.fires).toBe(false);
    expect(e.skipReason).toBe("in_cooldown");
    expect(e.observed).toBe(75_000); // still tells the operator the value
  });

  it("fires again once the cooldown has elapsed", () => {
    const e = evaluateRule(
      rule({ lastFiredAt: new Date("2026-08-11T02:00:00Z") }), // 32h ago
      metrics(),
      NOW,
    );
    expect(e.fires).toBe(true);
  });

  it("never fires while disabled", () => {
    const e = evaluateRule(rule({ enabled: false }), metrics(), NOW);
    expect(e.fires).toBe(false);
    expect(e.skipReason).toBe("rule_disabled");
  });

  it("reports the FIRST reason it declined, not the last", () => {
    // Disabled AND below floor AND under-synced — must say disabled.
    const e = evaluateRule(
      rule({ enabled: false }),
      metrics({ spendCents: 0, daysWithData: 0 }),
      NOW,
    );
    expect(e.skipReason).toBe("rule_disabled");
  });
});

describe("evaluateRule — conditions", () => {
  it("fires when the metric exceeds a gt threshold", () => {
    const e = evaluateRule(rule({ threshold: 50_000 }), metrics(), NOW); // CPA ₹750
    expect(e.fires).toBe(true);
    expect(e.observed).toBe(75_000);
    expect(e.explanation).toMatch(/above the/);
  });

  it("does not fire when the metric is under a gt threshold", () => {
    const e = evaluateRule(rule({ threshold: 100_000 }), metrics(), NOW);
    expect(e.fires).toBe(false);
    expect(e.skipReason).toBe("condition_not_met");
  });

  it("fires when the metric drops under an lt threshold", () => {
    const e = evaluateRule(
      rule({ metric: "roas", operator: "lt", threshold: 3 }),
      metrics(), // ROAS 2.0
      NOW,
    );
    expect(e.fires).toBe(true);
  });

  it("is strict at the boundary — equal does not fire", () => {
    const e = evaluateRule(rule({ threshold: 75_000 }), metrics(), NOW);
    expect(e.fires).toBe(false);
  });
});

describe("isInCooldown", () => {
  it("is false when the rule has never fired", () => {
    expect(isInCooldown({ cooldownHours: 24, lastFiredAt: null }, NOW)).toBe(false);
  });

  it("is true inside the window and false outside it", () => {
    expect(
      isInCooldown({ cooldownHours: 24, lastFiredAt: new Date("2026-08-12T00:00:00Z") }, NOW),
    ).toBe(true);
    expect(
      isInCooldown({ cooldownHours: 24, lastFiredAt: new Date("2026-08-11T00:00:00Z") }, NOW),
    ).toBe(false);
  });
});

describe("formatMetric", () => {
  it("renders money in the account currency and ratios in their own unit", () => {
    expect(formatMetric("cpa", 50_000)).toBe("₹500");
    expect(formatMetric("spend", 123_456, "$")).toBe("$1,235");
    expect(formatMetric("ctr", 0.0234)).toBe("2.34%");
    expect(formatMetric("roas", 2.5)).toBe("2.50x");
  });
});

describe("describeRule", () => {
  it("states the action, the guards and the cooldown in one sentence", () => {
    const text = describeRule(
      {
        metric: "cpa",
        operator: "gt",
        threshold: 50_000,
        windowDays: 3,
        action: "pause",
        minSpendCents: 100_000,
        cooldownHours: 24,
      },
      "campaign",
    );
    expect(text).toContain("CPA");
    expect(text).toContain("₹500");
    expect(text).toContain("pause the campaign");
    expect(text).toContain("₹1,000"); // the spend floor must be stated
    expect(text).toContain("24h"); // and so must the cooldown
  });

  it("describes a notify rule without claiming it pauses anything", () => {
    const text = describeRule(
      {
        metric: "roas",
        operator: "lt",
        threshold: 2,
        windowDays: 7,
        action: "notify",
        minSpendCents: 50_000,
        cooldownHours: 12,
      },
      "adset",
    );
    expect(text).toContain("send a notification");
    expect(text).not.toMatch(/\bpause\b/);
  });
});
