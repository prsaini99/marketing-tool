import { describe, expect, it } from "vitest";
import {
  campaignBlockReason,
  type AdSetDeliveryInput,
} from "@/lib/delivery-health";

const NOW = new Date("2026-08-13T00:00:00Z");

function set(over: Partial<AdSetDeliveryInput> = {}): AdSetDeliveryInput {
  return {
    metaAdSetId: "as_1",
    name: "Ad set",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    startTime: new Date("2026-01-01T00:00:00Z"),
    endTime: null,
    budgetRemainingCents: 100_00,
    dailyBudgetCents: 500_00,
    lifetimeBudgetCents: null,
    ...over,
  };
}

describe("campaignBlockReason", () => {
  it("stays silent for a campaign that is not active", () => {
    // Nothing to contradict: a paused campaign already reads as paused.
    expect(campaignBlockReason("PAUSED", [set({ endTime: new Date("2026-02-10") })], NOW)).toBeNull();
  });

  it("stays silent when at least one ad set can deliver", () => {
    const reason = campaignBlockReason(
      "ACTIVE",
      [set({ endTime: new Date("2026-02-10T00:00:00Z") }), set({ metaAdSetId: "as_2" })],
      NOW,
    );
    expect(reason).toBeNull();
  });

  it("reports the block when every active ad set has ended", () => {
    const reason = campaignBlockReason(
      "ACTIVE",
      [
        set({ endTime: new Date("2026-02-10T00:00:00Z") }),
        set({ metaAdSetId: "as_2", endTime: new Date("2026-01-13T00:00:00Z") }),
      ],
      NOW,
    );
    expect(reason?.reason).toBe("schedule_ended");
    expect(reason?.detail).toBeTruthy();
  });

  it("treats a campaign with no synced ad sets as unknown, not blocked", () => {
    // Absence of data is not evidence of a problem. Showing "Not delivering"
    // for a campaign whose ad sets simply have not synced yet would be a
    // false alarm on every freshly connected account.
    expect(campaignBlockReason("ACTIVE", [], NOW)).toBeNull();
  });

  it("ignores paused ad sets when deciding whether the campaign is blocked", () => {
    // A campaign with one running ad set and three paused ones is running.
    const reason = campaignBlockReason(
      "ACTIVE",
      [
        set(),
        set({ metaAdSetId: "as_2", status: "PAUSED", endTime: new Date("2026-01-01T00:00:00Z") }),
      ],
      NOW,
    );
    expect(reason).toBeNull();
  });

  it("reports the most common reason when they differ", () => {
    const reason = campaignBlockReason(
      "ACTIVE",
      [
        set({ effectiveStatus: "CAMPAIGN_PAUSED" }),
        set({ metaAdSetId: "as_2", effectiveStatus: "CAMPAIGN_PAUSED" }),
        set({ metaAdSetId: "as_3", endTime: new Date("2026-02-10T00:00:00Z") }),
      ],
      NOW,
    );
    expect(reason?.reason).toBe("parent_paused");
  });

  it("does not guess 'exhausted' from an unknown budget", () => {
    // budgetRemainingCents null means "synced before we captured it", and
    // treating unknown as zero would flag every legacy row as broken.
    const reason = campaignBlockReason(
      "ACTIVE",
      [set({ budgetRemainingCents: null })],
      NOW,
    );
    expect(reason).toBeNull();
  });
});
