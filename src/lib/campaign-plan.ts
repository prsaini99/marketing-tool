/**
 * Campaign plan: the object a copilot conversation produces, and the thing a
 * human approves. Pure module, no I/O.
 *
 * WHY A PLAN OBJECT RATHER THAN TURN-BY-TURN TOOL CALLS
 *
 * The obvious way to build an agent that launches campaigns is to hand it
 * create_campaign / create_adset / create_ad tools and let it call them as
 * the conversation goes. That is wrong here for four reasons:
 *
 *   1. A media buyer has to see the whole shape before approving. Approving
 *      fourteen separate tool calls is not the same as looking at "three ad
 *      sets, 2000 a day each, these audiences" and judging it.
 *   2. A plan can be validated and priced before anything costs money.
 *      validatePlan below catches the incompatibilities Meta would reject,
 *      plus the ones Meta accepts and the buyer regrets.
 *   3. Partial failure is survivable. If ad set 3 of 5 fails at Meta, an
 *      executor working from a plan knows exactly what was intended and what
 *      to roll back. An agent improvising mid-conversation does not.
 *   4. It matches the convention the rest of this codebase already follows:
 *      every create form ships a live payload preview so a reviewer can audit
 *      what will hit Meta. A plan is that idea generalised from one object to
 *      a campaign tree.
 *
 * This mirrors the split that already works in the automation engine, one
 * level up: decide() is pure and returns PlannedAction[], orchestrate() does
 * the I/O. Here, the plan is the pure artefact and the executor (a later
 * phase) does the writing.
 *
 * The shapes below deliberately mirror CreateCampaignInput,
 * CreateAdSetInput and CreateAdInput. Preview and execution must not be able
 * to drift, so the plan speaks the same language as the services that will
 * eventually run it.
 */

export type BudgetType = "daily" | "lifetime";

/** Meta objectives, as accepted by the campaign create service. */
export type Objective =
  | "OUTCOME_AWARENESS"
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_ENGAGEMENT"
  | "OUTCOME_LEADS"
  | "OUTCOME_APP_PROMOTION"
  | "OUTCOME_SALES";

export interface PlanCampaign {
  name: string;
  objective: Objective;
  /** Empty array means "None". Meta still requires the field. */
  specialAdCategories: string[];
  /** null means CBO off, so every ad set must carry its own budget. */
  budgetType: BudgetType | null;
  budgetCents?: number;
  bidStrategy?: string;
  spendCapCents?: number;
  /** ISO 8601. Required when budgetType is "lifetime". */
  stopTime?: string;
}

export interface PlanTargeting {
  /** ISO country codes. At least one. */
  countries: string[];
  ageMin: number;
  ageMax: number;
  /** null means all. [1] male, [2] female. */
  genders: number[] | null;
  placements: {
    facebookPositions?: string[];
    instagramPositions?: string[];
  } | null;
  includedAudienceIds?: string[];
  excludedAudienceIds?: string[];
}

export interface PlanAdSet {
  name: string;
  optimizationGoal: string;
  billingEvent?: string;
  /** Must be absent when the campaign has CBO on, present when it does not. */
  budgetType?: BudgetType | null;
  budgetCents?: number;
  startTime?: string;
  endTime?: string;
  targeting: PlanTargeting;
  promotedObject?: {
    pixelId?: string;
    customEventType?: string;
    customConversionId?: string;
    pageId?: string;
    applicationId?: string;
    objectStoreUrl?: string;
  };
  ads: PlanAd[];
}

export interface PlanAd {
  name: string;
  primaryText: string;
  headline: string;
  description?: string;
  /** Landing page. Not required for messaging destinations. */
  linkUrl?: string;
  callToAction?: string;
  /** Reference to an asset already in the account library. */
  mediaType: "image" | "video";
  imageHash?: string;
  videoId?: string;
}

export interface CampaignPlan {
  /** act_-prefixed Meta ad account id this plan targets. */
  metaAdAccountId: string;
  campaign: PlanCampaign;
  adSets: PlanAdSet[];
  /** One or two sentences on the reasoning, shown above the plan tree. */
  rationale?: string;
}

/* -------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------- */

export type IssueSeverity = "error" | "warning";

export interface PlanIssue {
  severity: IssueSeverity;
  /** Dotted path into the plan, e.g. "adSets[1].budgetCents". */
  path: string;
  message: string;
}

export interface ValidateOptions {
  /**
   * Hard ceiling on total daily spend a single plan may commit, in cents of
   * the account currency.
   *
   * THIS IS THE GUARDRAIL THAT MATTERS. A copilot is the first thing in this
   * product that lets a model commit money. The rules engine deliberately has
   * no automated action that increases spend; this feature only stays
   * consistent with that if the ceiling is enforced in code rather than
   * suggested in a prompt. A model that misplaces a decimal turns 2,000 a day
   * into 200,000 a day, and the plan tree looks equally plausible either way.
   */
  maxDailySpendCents: number;
  /**
   * Minimum daily budget Meta accepts, in cents. Currency dependent, so the
   * caller supplies it rather than this module guessing.
   */
  minDailyBudgetCents: number;
  /** Ad account currency, for message text only. */
  currency?: string;
}

/**
 * Objective to optimization-goal compatibility.
 *
 * Meta rejects an incompatible pairing with "Invalid parameter" and an
 * error_user_msg that names neither field, so an unvalidated plan fails
 * halfway through execution with a message nobody can act on. Encoding it
 * here turns that into a pre-flight error pointing at the exact ad set.
 *
 * Conservative on purpose: these are the pairings this codebase creates and
 * has seen accepted. An unknown goal is a warning rather than an error, so a
 * new Meta goal does not become an outage while someone updates this table.
 */
const GOALS_BY_OBJECTIVE: Record<Objective, string[]> = {
  OUTCOME_AWARENESS: ["REACH", "IMPRESSIONS", "AD_RECALL_LIFT", "THRUPLAY"],
  OUTCOME_TRAFFIC: [
    "LINK_CLICKS",
    "LANDING_PAGE_VIEWS",
    "IMPRESSIONS",
    "REACH",
  ],
  OUTCOME_ENGAGEMENT: [
    "POST_ENGAGEMENT",
    "THRUPLAY",
    "CONVERSATIONS",
    "LINK_CLICKS",
    "IMPRESSIONS",
    "REACH",
    "LEAD_GENERATION",
  ],
  OUTCOME_LEADS: [
    "LEAD_GENERATION",
    "OFFSITE_CONVERSIONS",
    "QUALITY_LEAD",
    "CONVERSATIONS",
    "LINK_CLICKS",
  ],
  OUTCOME_APP_PROMOTION: ["APP_INSTALLS", "OFFSITE_CONVERSIONS", "LINK_CLICKS"],
  OUTCOME_SALES: [
    "OFFSITE_CONVERSIONS",
    "VALUE",
    "LINK_CLICKS",
    "LANDING_PAGE_VIEWS",
    "CONVERSATIONS",
  ],
};

/** Goals that require a promoted_object naming what to count. */
const GOALS_NEEDING_PROMOTED_OBJECT = new Set([
  "OFFSITE_CONVERSIONS",
  "VALUE",
  "LEAD_GENERATION",
  "QUALITY_LEAD",
  "APP_INSTALLS",
  "CONVERSATIONS",
]);

/**
 * Categories where Meta forbids narrowing by age, gender or detailed
 * demographics. A plan that narrows anyway is rejected at create time, and
 * the message does not explain why.
 */
const RESTRICTED_AD_CATEGORIES = new Set([
  "HOUSING",
  "CREDIT",
  "EMPLOYMENT",
  "SOCIAL_ISSUES",
  "ISSUES_ELECTIONS_POLITICS",
]);

/** Goals whose destination is a conversation rather than a landing page. */
const MESSAGING_GOALS = new Set(["CONVERSATIONS"]);

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * Validate a plan against everything checkable without calling Meta.
 *
 * Errors block execution. Warnings are things Meta will accept and the buyer
 * may still regret, so they are surfaced without stopping approval.
 *
 * Returns every issue rather than throwing on the first, because the point of
 * a plan is to be repaired in one pass. A generator that gets one error back
 * at a time takes as many round trips as it made mistakes.
 */
export function validatePlan(
  plan: CampaignPlan,
  opts: ValidateOptions,
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const err = (path: string, message: string) =>
    issues.push({ severity: "error", path, message });
  const warn = (path: string, message: string) =>
    issues.push({ severity: "warning", path, message });

  const c = plan.campaign;

  if (!plan.metaAdAccountId?.startsWith("act_")) {
    err("metaAdAccountId", "Ad account id must be act_-prefixed.");
  }
  if (!c?.name?.trim()) err("campaign.name", "Campaign needs a name.");
  if (!plan.adSets?.length) {
    err("adSets", "A plan needs at least one ad set.");
    return issues;
  }

  const cboOn = c.budgetType != null;

  // Campaign budget rules.
  if (cboOn) {
    if (!c.budgetCents || c.budgetCents <= 0) {
      err("campaign.budgetCents", "Campaign budget must be greater than zero.");
    }
    if (c.budgetType === "lifetime" && !c.stopTime) {
      err("campaign.stopTime", "A lifetime campaign budget needs a stop time.");
    }
    if (
      c.budgetType === "daily" &&
      c.budgetCents &&
      c.budgetCents < opts.minDailyBudgetCents
    ) {
      err(
        "campaign.budgetCents",
        `Daily budget is below Meta's minimum of ${money(opts.minDailyBudgetCents, opts.currency)}.`,
      );
    }
  }
  if (c.stopTime && !isIsoDate(c.stopTime)) {
    err("campaign.stopTime", "Stop time must be an ISO 8601 date.");
  }

  const restricted = (c.specialAdCategories ?? []).filter((cat) =>
    RESTRICTED_AD_CATEGORIES.has(cat.toUpperCase()),
  );

  // Running total for the spend ceiling. Lifetime budgets are amortised over
  // the plan's own duration so a 30-day lifetime budget is not compared
  // against a daily ceiling as though it were spent in one day.
  let dailyCommittedCents = 0;

  const validGoals = GOALS_BY_OBJECTIVE[c.objective];
  if (!validGoals) {
    err("campaign.objective", `Unknown objective "${c.objective}".`);
  }

  plan.adSets.forEach((s, i) => {
    const at = `adSets[${i}]`;
    if (!s.name?.trim()) err(`${at}.name`, "Ad set needs a name.");
    if (!s.optimizationGoal) {
      err(`${at}.optimizationGoal`, "Ad set needs an optimization goal.");
    } else if (validGoals && !validGoals.includes(s.optimizationGoal)) {
      const known = Object.values(GOALS_BY_OBJECTIVE).flat();
      if (known.includes(s.optimizationGoal)) {
        err(
          `${at}.optimizationGoal`,
          `${s.optimizationGoal} is not valid for a ${c.objective} campaign. Meta rejects this pairing with a message that names neither field. Valid here: ${validGoals.join(", ")}.`,
        );
      } else {
        warn(
          `${at}.optimizationGoal`,
          `${s.optimizationGoal} is not a goal this tool has used before. Meta may reject it.`,
        );
      }
    }

    // Budget placement. This is the single most common plan error, because
    // whether a budget belongs on the campaign or the ad set is invisible
    // from the ad set alone.
    const hasBudget = s.budgetType != null;
    if (cboOn && hasBudget) {
      err(
        `${at}.budgetType`,
        "Campaign budget optimisation is on, so this ad set must not carry its own budget.",
      );
    }
    if (!cboOn && !hasBudget) {
      err(
        `${at}.budgetType`,
        "Campaign budget optimisation is off, so every ad set needs its own budget.",
      );
    }
    if (hasBudget) {
      if (!s.budgetCents || s.budgetCents <= 0) {
        err(`${at}.budgetCents`, "Ad set budget must be greater than zero.");
      } else if (
        s.budgetType === "daily" &&
        s.budgetCents < opts.minDailyBudgetCents
      ) {
        err(
          `${at}.budgetCents`,
          `Daily budget is below Meta's minimum of ${money(opts.minDailyBudgetCents, opts.currency)}.`,
        );
      }
      if (s.budgetType === "lifetime" && !s.endTime) {
        err(`${at}.endTime`, "A lifetime ad set budget needs an end time.");
      }
      if (s.budgetCents) {
        dailyCommittedCents +=
          s.budgetType === "daily"
            ? s.budgetCents
            : amortiseLifetime(s.budgetCents, s.startTime, s.endTime);
      }
    }

    if (s.startTime && !isIsoDate(s.startTime)) {
      err(`${at}.startTime`, "Start time must be an ISO 8601 date.");
    }
    if (s.endTime && !isIsoDate(s.endTime)) {
      err(`${at}.endTime`, "End time must be an ISO 8601 date.");
    }
    if (
      s.startTime &&
      s.endTime &&
      isIsoDate(s.startTime) &&
      isIsoDate(s.endTime) &&
      Date.parse(s.endTime) <= Date.parse(s.startTime)
    ) {
      err(`${at}.endTime`, "End time must be after start time.");
    }

    // Targeting.
    const t = s.targeting;
    if (!t) {
      err(`${at}.targeting`, "Ad set needs targeting.");
    } else {
      if (!t.countries?.length) {
        err(`${at}.targeting.countries`, "At least one country is required.");
      }
      if (t.ageMin < 13) {
        err(`${at}.targeting.ageMin`, "Minimum age on Meta is 13.");
      }
      if (t.ageMax > 65) {
        err(`${at}.targeting.ageMax`, "Maximum age on Meta is 65.");
      }
      if (t.ageMin > t.ageMax) {
        err(`${at}.targeting.ageMin`, "Minimum age is above maximum age.");
      }
      if (restricted.length) {
        // Meta forbids narrowing for these categories. Checked here because
        // the create call fails with a message that does not mention the
        // category at all.
        if (t.ageMin > 18 || t.ageMax < 65) {
          err(
            `${at}.targeting.ageMin`,
            `Special ad category ${restricted[0]} forbids age narrowing. Use 18 to 65.`,
          );
        }
        if (t.genders != null) {
          err(
            `${at}.targeting.genders`,
            `Special ad category ${restricted[0]} forbids gender targeting.`,
          );
        }
      }
      const overlap = (t.includedAudienceIds ?? []).filter((id) =>
        (t.excludedAudienceIds ?? []).includes(id),
      );
      if (overlap.length) {
        err(
          `${at}.targeting.excludedAudienceIds`,
          `Audience ${overlap[0]} is both included and excluded.`,
        );
      }
    }

    // promoted_object requirements.
    if (GOALS_NEEDING_PROMOTED_OBJECT.has(s.optimizationGoal)) {
      const po = s.promotedObject;
      const hasSomething =
        po &&
        (po.pixelId ||
          po.customConversionId ||
          po.pageId ||
          po.applicationId);
      if (!hasSomething) {
        err(
          `${at}.promotedObject`,
          `${s.optimizationGoal} needs a promoted object naming what to count (a pixel, custom conversion, page or app).`,
        );
      }
      if (po?.pixelId && po?.customConversionId) {
        err(
          `${at}.promotedObject`,
          "A pixel event and a custom conversion are mutually exclusive. Pick one.",
        );
      }
      if (po?.pixelId && !po.customEventType) {
        err(
          `${at}.promotedObject.customEventType`,
          "A pixel needs an event type, for example PURCHASE.",
        );
      }
      if (MESSAGING_GOALS.has(s.optimizationGoal) && !po?.pageId) {
        err(
          `${at}.promotedObject.pageId`,
          "A conversations goal needs the page id that will receive the messages.",
        );
      }
    }

    // Ads.
    if (!s.ads?.length) {
      err(`${at}.ads`, "Ad set has no ads.");
    }
    const messaging = MESSAGING_GOALS.has(s.optimizationGoal);
    s.ads?.forEach((ad, j) => {
      const ap = `${at}.ads[${j}]`;
      if (!ad.name?.trim()) err(`${ap}.name`, "Ad needs a name.");
      if (!ad.primaryText?.trim()) {
        err(`${ap}.primaryText`, "Ad needs primary text.");
      }
      if (!ad.headline?.trim()) err(`${ap}.headline`, "Ad needs a headline.");
      if (ad.mediaType === "image" && !ad.imageHash) {
        err(`${ap}.imageHash`, "Image ad needs a library image.");
      }
      if (ad.mediaType === "video" && !ad.videoId) {
        err(`${ap}.videoId`, "Video ad needs a library video.");
      }
      // A landing page is required unless the destination is a conversation.
      if (!messaging && !ad.linkUrl?.trim()) {
        err(`${ap}.linkUrl`, "Ad needs a destination URL.");
      }
      if (ad.linkUrl && !/^https?:\/\//i.test(ad.linkUrl)) {
        err(`${ap}.linkUrl`, "Destination URL must start with http or https.");
      }
      if (ad.headline && ad.headline.length > 40) {
        warn(
          `${ap}.headline`,
          `Headline is ${ad.headline.length} characters. Meta truncates most placements around 40.`,
        );
      }
    });
  });

  // The guardrail. Checked last so the message can report the real total.
  if (dailyCommittedCents > opts.maxDailySpendCents) {
    err(
      "campaign.budgetCents",
      `This plan commits ${money(dailyCommittedCents, opts.currency)} per day, above the ${money(opts.maxDailySpendCents, opts.currency)} ceiling for a single plan. Split it or raise the ceiling deliberately.`,
    );
  }
  if (cboOn && c.budgetType === "daily" && c.budgetCents) {
    if (c.budgetCents > opts.maxDailySpendCents) {
      err(
        "campaign.budgetCents",
        `Campaign daily budget ${money(c.budgetCents, opts.currency)} is above the ${money(opts.maxDailySpendCents, opts.currency)} ceiling for a single plan.`,
      );
    }
  }

  return issues;
}

/**
 * A lifetime budget spread across the ad set's own run length, so it can be
 * compared against a daily ceiling. Falls back to treating it as a single
 * day when the dates are missing, which is the conservative reading: it
 * makes the plan look more expensive, not less, so the ceiling errs toward
 * blocking rather than waving through.
 */
function amortiseLifetime(
  budgetCents: number,
  startTime?: string,
  endTime?: string,
): number {
  if (!startTime || !endTime) return budgetCents;
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return budgetCents;
  }
  const days = Math.max(1, Math.round((end - start) / 86_400_000));
  return Math.round(budgetCents / days);
}

/** Major units with a currency label, for issue messages only. */
function money(cents: number, currency?: string): string {
  const major = (cents / 100).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  });
  return currency ? `${major} ${currency}` : major;
}

/** True when the plan has no blocking issues. */
export function planIsExecutable(issues: PlanIssue[]): boolean {
  return !issues.some((i) => i.severity === "error");
}

/** Total daily spend a plan commits, for display above the approve button. */
export function planDailySpendCents(plan: CampaignPlan): number {
  if (plan.campaign.budgetType === "daily") {
    return plan.campaign.budgetCents ?? 0;
  }
  if (plan.campaign.budgetType === "lifetime") {
    return amortiseLifetime(
      plan.campaign.budgetCents ?? 0,
      plan.adSets[0]?.startTime,
      plan.campaign.stopTime,
    );
  }
  return plan.adSets.reduce((sum, s) => {
    if (!s.budgetType || !s.budgetCents) return sum;
    return (
      sum +
      (s.budgetType === "daily"
        ? s.budgetCents
        : amortiseLifetime(s.budgetCents, s.startTime, s.endTime))
    );
  }, 0);
}
