/**
 * Delivery capacity.
 *
 * These tests encode a real 68-day outage: an account where every status
 * read ACTIVE — account, campaigns, ads, and ad sets — while nothing
 * delivered, because every ad set's schedule had ended and its lifetime
 * budget was spent. The first case below is that account, to the day.
 */

import { describe, expect, it } from "vitest";
import {
  assessAccountDelivery,
  assessAdSet,
  describeDeliveryHealth,
  type AdSetDeliveryInput,
} from "@/lib/delivery-health";

const NOW = new Date("2026-08-12T00:00:00Z");

const adSet = (over: Partial<AdSetDeliveryInput> = {}): AdSetDeliveryInput => ({
  metaAdSetId: "a1",
  name: "Ad set",
  status: "ACTIVE",
  effectiveStatus: "ACTIVE",
  startTime: new Date("2026-01-01T00:00:00Z"),
  endTime: null,
  budgetRemainingCents: 50_000,
  dailyBudgetCents: 50_000,
  lifetimeBudgetCents: null,
  ...over,
});

describe("assessAdSet", () => {
  it("passes a genuinely live ad set", () => {
    expect(assessAdSet(adSet(), NOW).canDeliver).toBe(true);
  });

  it("catches an ad set whose schedule has ended", () => {
    // The real case: Meta still reports effective_status ACTIVE here.
    const r = assessAdSet(
      adSet({ endTime: new Date("2026-02-16T00:00:00Z"), effectiveStatus: "ACTIVE" }),
      NOW,
    );
    expect(r.canDeliver).toBe(false);
    expect(r.blockedBy).toBe("schedule_ended");
    expect(r.detail).toContain("2026-02-16");
  });

  it("catches an ad set scheduled to start in the future", () => {
    const r = assessAdSet(adSet({ startTime: new Date("2026-09-01T00:00:00Z") }), NOW);
    expect(r.blockedBy).toBe("schedule_not_started");
  });

  it("catches an exhausted lifetime budget", () => {
    const r = assessAdSet(
      adSet({ lifetimeBudgetCents: 40_000, budgetRemainingCents: 0, dailyBudgetCents: null }),
      NOW,
    );
    expect(r.blockedBy).toBe("budget_exhausted");
  });

  it("does NOT treat a daily-budget ad set at zero remaining as exhausted", () => {
    // Daily budgets refill; alerting here would fire every evening.
    const r = assessAdSet(
      adSet({ dailyBudgetCents: 50_000, lifetimeBudgetCents: null, budgetRemainingCents: 0 }),
      NOW,
    );
    expect(r.canDeliver).toBe(true);
  });

  it("does NOT treat unknown remaining budget as exhausted", () => {
    // null = never synced (legacy row), not zero.
    const r = assessAdSet(
      adSet({ lifetimeBudgetCents: 40_000, budgetRemainingCents: null }),
      NOW,
    );
    expect(r.canDeliver).toBe(true);
  });

  it("reports the schedule before the budget when both are spent", () => {
    // "ended 16 Feb" explains the empty budget; the reverse doesn't.
    const r = assessAdSet(
      adSet({
        endTime: new Date("2026-02-16T00:00:00Z"),
        lifetimeBudgetCents: 40_000,
        budgetRemainingCents: 0,
      }),
      NOW,
    );
    expect(r.blockedBy).toBe("schedule_ended");
  });

  it("reports a paused ad set as not active", () => {
    expect(assessAdSet(adSet({ status: "PAUSED" }), NOW).blockedBy).toBe("not_active");
  });
});

describe("assessAccountDelivery", () => {
  it("flags the real outage: every active ad set expired", () => {
    const expired = Array.from({ length: 13 }, (_, i) =>
      adSet({
        metaAdSetId: `a${i}`,
        endTime: new Date("2026-02-16T00:00:00Z"),
        lifetimeBudgetCents: 41_100,
        budgetRemainingCents: 0,
        dailyBudgetCents: null,
      }),
    );
    const h = assessAccountDelivery(expired, NOW);
    expect(h.intendedActive).toBe(13);
    expect(h.canDeliver).toBe(0);
    expect(h.allStopped).toBe(true);
    expect(h.reasons.schedule_ended).toBe(13);
  });

  it("does not cry wolf when one ad set is still live", () => {
    const h = assessAccountDelivery(
      [adSet({ metaAdSetId: "dead", endTime: new Date("2026-02-16T00:00:00Z") }), adSet({ metaAdSetId: "live" })],
      NOW,
    );
    expect(h.allStopped).toBe(false);
    expect(h.canDeliver).toBe(1);
    expect(h.blocked).toHaveLength(1);
  });

  it("does not alert on an account paused on purpose", () => {
    // Everything paused is a decision, not an incident. Alerting here would
    // train the operator to ignore the alert that matters.
    const h = assessAccountDelivery(
      [adSet({ status: "PAUSED" }), adSet({ status: "PAUSED" })],
      NOW,
    );
    expect(h.intendedActive).toBe(0);
    expect(h.allStopped).toBe(false);
  });

  it("handles an account with no ad sets at all", () => {
    const h = assessAccountDelivery([], NOW);
    expect(h.allStopped).toBe(false);
    expect(h.blocked).toEqual([]);
  });
});

describe("describeDeliveryHealth", () => {
  it("names the reasons and the contradiction when everything is stopped", () => {
    const h = assessAccountDelivery(
      [
        adSet({ metaAdSetId: "a", endTime: new Date("2026-02-16T00:00:00Z") }),
        adSet({
          metaAdSetId: "b",
          lifetimeBudgetCents: 40_000,
          budgetRemainingCents: 0,
          dailyBudgetCents: null,
        }),
      ],
      NOW,
    );
    const text = describeDeliveryHealth(h);
    expect(text).toContain("past their end date");
    expect(text).toContain("out of lifetime budget");
    expect(text).toMatch(/reading ACTIVE/i);
  });

  it("is calm when everything is fine", () => {
    const text = describeDeliveryHealth(assessAccountDelivery([adSet()], NOW));
    expect(text).toMatch(/can deliver/i);
  });

  it("distinguishes 'nothing is meant to be running' from an outage", () => {
    const text = describeDeliveryHealth(
      assessAccountDelivery([adSet({ status: "PAUSED" })], NOW),
    );
    expect(text).toMatch(/nothing is expected to deliver/i);
  });
});

describe("effectiveStatus is a one-way signal", () => {
  it("blocks an ad set whose parent campaign is paused", () => {
    // status ACTIVE + effective_status CAMPAIGN_PAUSED is Meta's way of
    // saying "this ad set is fine, but nothing above it is running".
    const r = assessAdSet(
      adSet({ status: "ACTIVE", effectiveStatus: "CAMPAIGN_PAUSED" }),
      NOW,
    );
    expect(r.canDeliver).toBe(false);
    expect(r.blockedBy).toBe("parent_paused");
  });

  it("blocks on other non-delivering effective statuses", () => {
    for (const eff of ["ARCHIVED", "DELETED", "ADSET_PAUSED", "PENDING_REVIEW"]) {
      expect(assessAdSet(adSet({ effectiveStatus: eff }), NOW).canDeliver, eff).toBe(
        false,
      );
    }
  });

  it("does NOT treat effectiveStatus ACTIVE as proof of delivery", () => {
    // The core trap: ACTIVE proves nothing. The schedule check must still win.
    const r = assessAdSet(
      adSet({ effectiveStatus: "ACTIVE", endTime: new Date("2026-02-16T00:00:00Z") }),
      NOW,
    );
    expect(r.canDeliver).toBe(false);
    expect(r.blockedBy).toBe("schedule_ended");
  });

  it("still works when effectiveStatus was never synced", () => {
    expect(assessAdSet(adSet({ effectiveStatus: null }), NOW).canDeliver).toBe(true);
  });

  it("flags an account where every ad set sits under paused campaigns", () => {
    const h = assessAccountDelivery(
      Array.from({ length: 9 }, (_, i) =>
        adSet({ metaAdSetId: `p${i}`, effectiveStatus: "CAMPAIGN_PAUSED" }),
      ),
      NOW,
    );
    expect(h.allStopped).toBe(true);
    expect(h.reasons.parent_paused).toBe(9);
    expect(describeDeliveryHealth(h)).toContain("in a paused campaign");
  });
});
