import { describe, expect, it } from "vitest";
import {
  planDailySpendCents,
  planIsExecutable,
  validatePlan,
  type CampaignPlan,
  type PlanAdSet,
  type ValidateOptions,
} from "@/lib/campaign-plan";

const OPTS: ValidateOptions = {
  maxDailySpendCents: 50_000_00, // 50,000 a day
  minDailyBudgetCents: 80_00, // 80 a day
  currency: "INR",
};

function adSet(over: Partial<PlanAdSet> = {}): PlanAdSet {
  return {
    name: "Prospecting",
    optimizationGoal: "LINK_CLICKS",
    budgetType: "daily",
    budgetCents: 2_000_00,
    targeting: {
      countries: ["IN"],
      ageMin: 25,
      ageMax: 45,
      genders: null,
      placements: null,
    },
    ads: [
      {
        name: "Ad 1",
        primaryText: "Body copy",
        headline: "Headline",
        linkUrl: "https://example.com",
        mediaType: "image",
        imageHash: "abc123",
      },
    ],
    ...over,
  };
}

function plan(over: Partial<CampaignPlan> = {}): CampaignPlan {
  return {
    metaAdAccountId: "act_123",
    campaign: {
      name: "Q3 Traffic",
      objective: "OUTCOME_TRAFFIC",
      specialAdCategories: [],
      budgetType: null, // CBO off, budgets live on ad sets
    },
    adSets: [adSet()],
    ...over,
  };
}

const errors = (p: CampaignPlan, o: ValidateOptions = OPTS) =>
  validatePlan(p, o).filter((i) => i.severity === "error");
const paths = (p: CampaignPlan, o: ValidateOptions = OPTS) =>
  errors(p, o).map((i) => i.path);

describe("a well-formed plan", () => {
  it("produces no errors", () => {
    expect(errors(plan())).toEqual([]);
    expect(planIsExecutable(validatePlan(plan(), OPTS))).toBe(true);
  });
});

describe("budget placement", () => {
  it("rejects an ad set budget when campaign budget optimisation is on", () => {
    const p = plan({
      campaign: {
        name: "C",
        objective: "OUTCOME_TRAFFIC",
        specialAdCategories: [],
        budgetType: "daily",
        budgetCents: 5_000_00,
      },
    });
    expect(paths(p)).toContain("adSets[0].budgetType");
  });

  it("requires an ad set budget when campaign budget optimisation is off", () => {
    const p = plan({
      adSets: [adSet({ budgetType: null, budgetCents: undefined })],
    });
    expect(paths(p)).toContain("adSets[0].budgetType");
  });

  it("accepts CBO on with no ad set budgets", () => {
    const p = plan({
      campaign: {
        name: "C",
        objective: "OUTCOME_TRAFFIC",
        specialAdCategories: [],
        budgetType: "daily",
        budgetCents: 5_000_00,
      },
      adSets: [adSet({ budgetType: null, budgetCents: undefined })],
    });
    expect(errors(p)).toEqual([]);
  });

  it("requires a stop time for a lifetime campaign budget", () => {
    const p = plan({
      campaign: {
        name: "C",
        objective: "OUTCOME_TRAFFIC",
        specialAdCategories: [],
        budgetType: "lifetime",
        budgetCents: 50_000_00,
      },
      adSets: [adSet({ budgetType: null, budgetCents: undefined })],
    });
    expect(paths(p)).toContain("campaign.stopTime");
  });

  it("requires an end time for a lifetime ad set budget", () => {
    const p = plan({
      adSets: [adSet({ budgetType: "lifetime", budgetCents: 20_000_00 })],
    });
    expect(paths(p)).toContain("adSets[0].endTime");
  });

  it("rejects a daily budget below Meta's minimum", () => {
    const p = plan({ adSets: [adSet({ budgetCents: 50_00 })] });
    expect(paths(p)).toContain("adSets[0].budgetCents");
  });
});

describe("objective and optimization goal compatibility", () => {
  it("rejects a known goal that is wrong for the objective", () => {
    // OFFSITE_CONVERSIONS is real, but not valid under OUTCOME_AWARENESS.
    const p = plan({
      campaign: {
        name: "C",
        objective: "OUTCOME_AWARENESS",
        specialAdCategories: [],
        budgetType: null,
      },
      adSets: [adSet({ optimizationGoal: "OFFSITE_CONVERSIONS" })],
    });
    const issue = errors(p).find(
      (i) => i.path === "adSets[0].optimizationGoal",
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("OUTCOME_AWARENESS");
  });

  it("warns rather than errors on a goal it has never seen", () => {
    // A new Meta goal must not become an outage while this table is updated.
    const p = plan({
      adSets: [adSet({ optimizationGoal: "SOME_NEW_GOAL_2027" })],
    });
    const all = validatePlan(p, OPTS);
    expect(all.some((i) => i.severity === "warning")).toBe(true);
    expect(paths(p)).not.toContain("adSets[0].optimizationGoal");
  });

  it("accepts CONVERSATIONS under an engagement objective", () => {
    const p = plan({
      campaign: {
        name: "C",
        objective: "OUTCOME_ENGAGEMENT",
        specialAdCategories: [],
        budgetType: null,
      },
      adSets: [
        adSet({
          optimizationGoal: "CONVERSATIONS",
          promotedObject: { pageId: "932368496624251" },
          ads: [
            {
              name: "Ad 1",
              primaryText: "Message us",
              headline: "Talk to us",
              mediaType: "image",
              imageHash: "abc",
            },
          ],
        }),
      ],
    });
    expect(errors(p)).toEqual([]);
  });
});

describe("promoted object", () => {
  it("requires one for a conversions goal", () => {
    const p = plan({
      campaign: {
        name: "C",
        objective: "OUTCOME_SALES",
        specialAdCategories: [],
        budgetType: null,
      },
      adSets: [adSet({ optimizationGoal: "OFFSITE_CONVERSIONS" })],
    });
    expect(paths(p)).toContain("adSets[0].promotedObject");
  });

  it("rejects a pixel and a custom conversion together", () => {
    const p = plan({
      campaign: {
        name: "C",
        objective: "OUTCOME_SALES",
        specialAdCategories: [],
        budgetType: null,
      },
      adSets: [
        adSet({
          optimizationGoal: "OFFSITE_CONVERSIONS",
          promotedObject: {
            pixelId: "1",
            customEventType: "PURCHASE",
            customConversionId: "2",
          },
        }),
      ],
    });
    expect(paths(p)).toContain("adSets[0].promotedObject");
  });

  it("requires an event type alongside a pixel", () => {
    const p = plan({
      campaign: {
        name: "C",
        objective: "OUTCOME_SALES",
        specialAdCategories: [],
        budgetType: null,
      },
      adSets: [
        adSet({
          optimizationGoal: "OFFSITE_CONVERSIONS",
          promotedObject: { pixelId: "1" },
        }),
      ],
    });
    expect(paths(p)).toContain("adSets[0].promotedObject.customEventType");
  });

  it("requires a page id for a messaging goal", () => {
    const p = plan({
      campaign: {
        name: "C",
        objective: "OUTCOME_ENGAGEMENT",
        specialAdCategories: [],
        budgetType: null,
      },
      adSets: [
        adSet({
          optimizationGoal: "CONVERSATIONS",
          promotedObject: { pixelId: "1", customEventType: "PURCHASE" },
        }),
      ],
    });
    expect(paths(p)).toContain("adSets[0].promotedObject.pageId");
  });
});

describe("targeting", () => {
  it("rejects an empty country list", () => {
    const p = plan({
      adSets: [
        adSet({
          targeting: {
            countries: [],
            ageMin: 25,
            ageMax: 45,
            genders: null,
            placements: null,
          },
        }),
      ],
    });
    expect(paths(p)).toContain("adSets[0].targeting.countries");
  });

  it("enforces Meta's 13 to 65 age bounds", () => {
    const low = plan({
      adSets: [
        adSet({
          targeting: {
            countries: ["IN"],
            ageMin: 12,
            ageMax: 45,
            genders: null,
            placements: null,
          },
        }),
      ],
    });
    expect(paths(low)).toContain("adSets[0].targeting.ageMin");

    const high = plan({
      adSets: [
        adSet({
          targeting: {
            countries: ["IN"],
            ageMin: 25,
            ageMax: 70,
            genders: null,
            placements: null,
          },
        }),
      ],
    });
    expect(paths(high)).toContain("adSets[0].targeting.ageMax");
  });

  it("rejects an inverted age range", () => {
    const p = plan({
      adSets: [
        adSet({
          targeting: {
            countries: ["IN"],
            ageMin: 45,
            ageMax: 25,
            genders: null,
            placements: null,
          },
        }),
      ],
    });
    expect(paths(p)).toContain("adSets[0].targeting.ageMin");
  });

  it("catches an audience that is both included and excluded", () => {
    const p = plan({
      adSets: [
        adSet({
          targeting: {
            countries: ["IN"],
            ageMin: 25,
            ageMax: 45,
            genders: null,
            placements: null,
            includedAudienceIds: ["aud_1", "aud_2"],
            excludedAudienceIds: ["aud_2"],
          },
        }),
      ],
    });
    const issue = errors(p).find(
      (i) => i.path === "adSets[0].targeting.excludedAudienceIds",
    );
    expect(issue?.message).toContain("aud_2");
  });
});

describe("special ad categories", () => {
  const housing = (over: Partial<PlanAdSet>) =>
    plan({
      campaign: {
        name: "C",
        objective: "OUTCOME_TRAFFIC",
        specialAdCategories: ["HOUSING"],
        budgetType: null,
      },
      adSets: [adSet(over)],
    });

  it("forbids age narrowing", () => {
    expect(paths(housing({}))).toContain("adSets[0].targeting.ageMin");
  });

  it("forbids gender targeting", () => {
    const p = housing({
      targeting: {
        countries: ["IN"],
        ageMin: 18,
        ageMax: 65,
        genders: [2],
        placements: null,
      },
    });
    expect(paths(p)).toContain("adSets[0].targeting.genders");
  });

  it("accepts the full 18 to 65 range with no gender filter", () => {
    const p = housing({
      targeting: {
        countries: ["IN"],
        ageMin: 18,
        ageMax: 65,
        genders: null,
        placements: null,
      },
    });
    expect(errors(p)).toEqual([]);
  });
});

describe("ads", () => {
  it("requires a destination URL for a non-messaging goal", () => {
    const p = plan({
      adSets: [
        adSet({
          ads: [
            {
              name: "Ad",
              primaryText: "x",
              headline: "y",
              mediaType: "image",
              imageHash: "h",
            },
          ],
        }),
      ],
    });
    expect(paths(p)).toContain("adSets[0].ads[0].linkUrl");
  });

  it("does not require a URL when the destination is a conversation", () => {
    const p = plan({
      campaign: {
        name: "C",
        objective: "OUTCOME_ENGAGEMENT",
        specialAdCategories: [],
        budgetType: null,
      },
      adSets: [
        adSet({
          optimizationGoal: "CONVERSATIONS",
          promotedObject: { pageId: "p1" },
          ads: [
            {
              name: "Ad",
              primaryText: "x",
              headline: "y",
              mediaType: "image",
              imageHash: "h",
            },
          ],
        }),
      ],
    });
    expect(errors(p)).toEqual([]);
  });

  it("rejects a media reference that is missing its asset", () => {
    const p = plan({
      adSets: [
        adSet({
          ads: [
            {
              name: "Ad",
              primaryText: "x",
              headline: "y",
              linkUrl: "https://e.com",
              mediaType: "video",
            },
          ],
        }),
      ],
    });
    expect(paths(p)).toContain("adSets[0].ads[0].videoId");
  });

  it("warns on an over-long headline without blocking", () => {
    const p = plan({
      adSets: [
        adSet({
          ads: [
            {
              name: "Ad",
              primaryText: "x",
              headline: "y".repeat(60),
              linkUrl: "https://e.com",
              mediaType: "image",
              imageHash: "h",
            },
          ],
        }),
      ],
    });
    expect(errors(p)).toEqual([]);
    expect(validatePlan(p, OPTS).some((i) => i.severity === "warning")).toBe(
      true,
    );
  });

  it("flags an ad set with no ads", () => {
    const p = plan({ adSets: [adSet({ ads: [] })] });
    expect(paths(p)).toContain("adSets[0].ads");
  });
});

describe("the spend ceiling", () => {
  it("blocks a plan committing more per day than the ceiling", () => {
    // Three ad sets at 20,000 a day is 60,000, over the 50,000 ceiling.
    const p = plan({
      adSets: [
        adSet({ name: "A", budgetCents: 20_000_00 }),
        adSet({ name: "B", budgetCents: 20_000_00 }),
        adSet({ name: "C", budgetCents: 20_000_00 }),
      ],
    });
    const issue = errors(p).find((i) => i.path === "campaign.budgetCents");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("60,000");
  });

  it("catches the misplaced decimal that makes 2,000 into 200,000", () => {
    const p = plan({ adSets: [adSet({ budgetCents: 200_000_00 })] });
    expect(paths(p)).toContain("campaign.budgetCents");
  });

  it("amortises a lifetime budget over its run rather than counting it as one day", () => {
    // 300,000 over 30 days is 10,000 a day, comfortably under the ceiling.
    // Counted as a single day it would falsely trip it.
    const p = plan({
      adSets: [
        adSet({
          budgetType: "lifetime",
          budgetCents: 300_000_00,
          startTime: "2026-09-01T00:00:00+0530",
          endTime: "2026-10-01T00:00:00+0530",
        }),
      ],
    });
    expect(errors(p)).toEqual([]);
  });

  it("treats a lifetime budget with no dates as same-day, erring toward blocking", () => {
    const p = plan({
      adSets: [
        adSet({
          budgetType: "lifetime",
          budgetCents: 300_000_00,
          endTime: undefined,
        }),
      ],
    });
    // Missing endTime is its own error, and the ceiling also trips because
    // an undatable lifetime budget is counted at full value.
    expect(paths(p)).toContain("campaign.budgetCents");
  });
});

describe("dates", () => {
  it("rejects an end time at or before the start", () => {
    const p = plan({
      adSets: [
        adSet({
          startTime: "2026-09-10T00:00:00+0530",
          endTime: "2026-09-01T00:00:00+0530",
        }),
      ],
    });
    expect(paths(p)).toContain("adSets[0].endTime");
  });

  it("rejects a non-ISO date", () => {
    const p = plan({ adSets: [adSet({ startTime: "next tuesday" })] });
    expect(paths(p)).toContain("adSets[0].startTime");
  });
});

describe("structural guards", () => {
  it("requires an act_-prefixed account id", () => {
    expect(paths(plan({ metaAdAccountId: "123" }))).toContain(
      "metaAdAccountId",
    );
  });

  it("stops early on a plan with no ad sets rather than reporting noise", () => {
    const issues = validatePlan(plan({ adSets: [] }), OPTS);
    expect(issues.map((i) => i.path)).toEqual(["adSets"]);
  });

  it("reports every problem at once so one repair pass can fix them all", () => {
    // A generator handed one error at a time needs as many round trips as it
    // made mistakes, so returning the full set is load-bearing.
    const p = plan({
      metaAdAccountId: "nope",
      adSets: [
        adSet({
          name: "",
          budgetCents: 1,
          targeting: {
            countries: [],
            ageMin: 5,
            ageMax: 99,
            genders: null,
            placements: null,
          },
        }),
      ],
    });
    expect(errors(p).length).toBeGreaterThanOrEqual(5);
  });
});

describe("planDailySpendCents", () => {
  it("sums ad set daily budgets when CBO is off", () => {
    const p = plan({
      adSets: [
        adSet({ budgetCents: 2_000_00 }),
        adSet({ budgetCents: 3_000_00 }),
      ],
    });
    expect(planDailySpendCents(p)).toBe(5_000_00);
  });

  it("uses the campaign budget when CBO is on", () => {
    const p = plan({
      campaign: {
        name: "C",
        objective: "OUTCOME_TRAFFIC",
        specialAdCategories: [],
        budgetType: "daily",
        budgetCents: 7_500_00,
      },
      adSets: [adSet({ budgetType: null, budgetCents: undefined })],
    });
    expect(planDailySpendCents(p)).toBe(7_500_00);
  });
});

describe("pinned assets", () => {
  const withAd = (over: Record<string, unknown>) =>
    plan({
      adSets: [
        adSet({
          ads: [
            {
              name: "Ad",
              primaryText: "x",
              headline: "y",
              linkUrl: "https://e.com",
              mediaType: "image",
              imageHash: "abc123",
              ...over,
            },
          ],
        }),
      ],
    });

  it("accepts a plan that uses the pinned image", () => {
    const issues = validatePlan(withAd({}), {
      ...OPTS,
      pinnedImageHashes: ["abc123"],
    });
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("rejects a plan that ignores the pinned image", () => {
    // Pinning is an act of having already decided. A model that quietly
    // picks something else has overruled the operator.
    const issues = validatePlan(withAd({ imageHash: "somethingelse" }), {
      ...OPTS,
      pinnedImageHashes: ["abc123"],
    });
    const e = issues.find((i) => i.severity === "error");
    expect(e?.message).toContain("abc123");
  });

  it("rejects a plan that ignores a pinned video", () => {
    const issues = validatePlan(withAd({}), {
      ...OPTS,
      pinnedVideoIds: ["vid_9"],
    });
    expect(issues.some((i) => i.message.includes("vid_9"))).toBe(true);
  });

  it("checks inclusion across the plan, not per ad set", () => {
    // Two pins, one used in each ad set. Neither appears in both, and that
    // is fine: "use this creative" means somewhere in this campaign. How it
    // is spread is the brief's business, not the validator's.
    const p = plan({
      adSets: [
        adSet({ name: "A" }), // uses abc123
        adSet({
          name: "B",
          ads: [
            {
              name: "Ad B",
              primaryText: "x",
              headline: "y",
              linkUrl: "https://e.com",
              mediaType: "image",
              imageHash: "pinned-two",
            },
          ],
        }),
      ],
    });
    const issues = validatePlan(p, {
      ...OPTS,
      pinnedImageHashes: ["abc123", "pinned-two"],
    });
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("does nothing when nothing is pinned", () => {
    expect(errors(withAd({}))).toEqual([]);
  });
});

describe("pinned assets are exclusive", () => {
  it("rejects an ad using a creative that was not pinned", () => {
    // The failure this catches: the agent honours the pin in ad set one and
    // then fills ad set two from the rest of the library, which is not what
    // "I chose this creative" means.
    const p = plan({
      adSets: [
        adSet({ name: "A" }), // uses abc123
        adSet({
          name: "B",
          ads: [
            {
              name: "Ad B",
              primaryText: "x",
              headline: "y",
              linkUrl: "https://e.com",
              mediaType: "image",
              imageHash: "something-else",
            },
          ],
        }),
      ],
    });
    const issues = validatePlan(p, { ...OPTS, pinnedImageHashes: ["abc123"] });
    expect(
      issues.some((i) => i.path === "adSets[1].ads[0].imageHash"),
    ).toBe(true);
  });

  it("allows a pinned creative to be reused across ad sets", () => {
    // Exclusivity restricts WHICH creatives, not how many times each appears.
    const p = plan({ adSets: [adSet({ name: "A" }), adSet({ name: "B" })] });
    const issues = validatePlan(p, { ...OPTS, pinnedImageHashes: ["abc123"] });
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("leaves the whole library available when nothing is pinned", () => {
    expect(errors(plan())).toEqual([]);
  });

  it("allows a pinned video alongside a pinned image", () => {
    const p = plan({
      adSets: [
        adSet({ name: "A" }),
        adSet({
          name: "B",
          ads: [
            {
              name: "Ad B",
              primaryText: "x",
              headline: "y",
              linkUrl: "https://e.com",
              mediaType: "video",
              videoId: "vid_7",
            },
          ],
        }),
      ],
    });
    const issues = validatePlan(p, {
      ...OPTS,
      pinnedImageHashes: ["abc123"],
      pinnedVideoIds: ["vid_7"],
    });
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
