/**
 * Create a new ad set on Meta + mirror locally.
 *
 * Mirrors campaigns/create.ts:
 *   1. AuditLog row BEFORE the Meta call (captures intent on failure).
 *   2. POST to Meta.
 *   3. Insert local AdSet row on success.
 *   4. Stamp audit row with the new Meta id.
 *
 * Constraints enforced by Meta we surface explicitly:
 *   • If the parent campaign has CBO on, no budget is allowed on the ad set.
 *   • If the parent campaign has CBO off, budget IS required.
 *   • Lifetime budget requires `end_time`.
 *   • `optimization_goal` must be compatible with the parent campaign's
 *     objective — we don't enforce that here; Meta returns the specific
 *     error and we surface it via readMetaError.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export interface CreateAdSetTargeting {
  // ISO country codes (e.g., ["IN", "US"]).
  countries: string[];
  ageMin: number;
  ageMax: number;
  // null = all, [1] = male, [2] = female.
  genders: number[] | null;
  // null = automatic placements; otherwise the user picked specific ones.
  placements: {
    facebookPositions?: string[]; // ["feed", "right_hand_column", ...]
    instagramPositions?: string[]; // ["stream", "story", "reels", ...]
  } | null;
}

// Meta requires `promoted_object` on the ad set for objectives that need
// something to "count" — conversions, leads, app installs. We forward only
// the fields the caller provides; the goal selector in the UI decides which
// fields show up.
export interface CreateAdSetPromotedObject {
  pixelId?: string;
  customEventType?: string; // e.g., "PURCHASE"
  pageId?: string;
  applicationId?: string;
  objectStoreUrl?: string;
}

export interface CreateAdSetInput {
  metaCampaignId: string; // parent campaign on Meta
  name: string;
  status: "PAUSED" | "ACTIVE";
  optimizationGoal: string; // e.g., "LINK_CLICKS"
  billingEvent?: string; // defaults to "IMPRESSIONS"
  // Required only if parent campaign has CBO off.
  budgetType?: "daily" | "lifetime" | null;
  budgetCents?: number;
  startTime?: string; // ISO 8601; defaults to now if omitted
  endTime?: string; // ISO 8601; required when budgetType = "lifetime"
  targeting: CreateAdSetTargeting;
  promotedObject?: CreateAdSetPromotedObject;
}

export interface CreateAdSetResult {
  metaAdSetId: string;
  // Local Prisma id of the inserted AdSet row.
  adSetId: string;
}

export async function createAdSet(
  input: CreateAdSetInput,
): Promise<CreateAdSetResult> {
  const name = input.name?.trim();
  if (!name) throw new Error("name is required");
  if (input.status !== "PAUSED" && input.status !== "ACTIVE") {
    throw new Error("status must be 'PAUSED' or 'ACTIVE'");
  }
  if (!input.optimizationGoal) {
    throw new Error("optimizationGoal is required");
  }
  if (input.budgetType) {
    if (!input.budgetCents || input.budgetCents <= 0) {
      throw new Error("budgetCents must be > 0 when budgetType is set");
    }
    if (input.budgetType === "lifetime" && !input.endTime) {
      throw new Error("endTime is required for lifetime budgets");
    }
  }
  if (!input.targeting.countries.length) {
    throw new Error("targeting.countries must include at least one country");
  }
  if (input.targeting.ageMin < 13 || input.targeting.ageMax > 65) {
    throw new Error("age must be between 13 and 65");
  }

  // Resolve parent campaign (must be in a selected-for-sync account).
  const campaign = await prisma.campaign.findFirst({
    where: {
      metaCampaignId: input.metaCampaignId,
      adAccount: { selectedForSync: true },
    },
    include: {
      adAccount: {
        include: { business: { include: { connection: true } } },
      },
    },
  });
  if (!campaign) {
    throw new Error(
      "Parent campaign not found in any selected-for-sync account",
    );
  }

  // CBO compatibility check — Meta will reject otherwise, but we can fail
  // fast with a clearer message.
  const campaignHasCbo =
    campaign.dailyBudgetCents != null || campaign.lifetimeBudgetCents != null;
  if (campaignHasCbo && input.budgetType) {
    throw new Error(
      "Parent campaign uses CBO — ad set must not set its own budget",
    );
  }
  if (!campaignHasCbo && !input.budgetType) {
    throw new Error(
      "Parent campaign has no CBO budget — ad set must set a daily or lifetime budget",
    );
  }

  const intent = {
    name,
    campaignMetaId: campaign.metaCampaignId,
    status: input.status,
    optimizationGoal: input.optimizationGoal,
    billingEvent: input.billingEvent ?? "IMPRESSIONS",
    budgetType: input.budgetType ?? null,
    budgetCents: input.budgetCents ?? null,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    targeting: input.targeting,
    promotedObject: input.promotedObject ?? null,
  };

  const auditRow = await prisma.auditLog.create({
    data: {
      action: "adset.create",
      targetType: "adset",
      targetId: "(pending)",
      before: {},
      // Cast: nested optional targeting shape confuses Prisma's strict JSON
      // type, but the runtime payload is plain JSON-serializable.
      after: { ...intent, _pending: true } as unknown as Prisma.InputJsonValue,
    },
  });

  // Build Meta payload.
  const targeting: Record<string, unknown> = {
    geo_locations: { countries: input.targeting.countries },
    age_min: input.targeting.ageMin,
    age_max: input.targeting.ageMax,
  };
  if (input.targeting.genders && input.targeting.genders.length > 0) {
    targeting.genders = input.targeting.genders;
  }
  if (input.targeting.placements) {
    // Manual placements — derive publisher_platforms from what's checked.
    const publisherPlatforms: string[] = [];
    if (input.targeting.placements.facebookPositions?.length) {
      publisherPlatforms.push("facebook");
      targeting.facebook_positions = input.targeting.placements.facebookPositions;
    }
    if (input.targeting.placements.instagramPositions?.length) {
      publisherPlatforms.push("instagram");
      targeting.instagram_positions =
        input.targeting.placements.instagramPositions;
    }
    if (publisherPlatforms.length > 0) {
      targeting.publisher_platforms = publisherPlatforms;
    }
  }

  const payload: Record<string, unknown> = {
    name,
    campaign_id: campaign.metaCampaignId,
    status: input.status,
    optimization_goal: input.optimizationGoal,
    billing_event: input.billingEvent ?? "IMPRESSIONS",
    targeting,
  };
  if (input.budgetType === "daily") {
    payload.daily_budget = String(input.budgetCents);
  }
  if (input.budgetType === "lifetime") {
    payload.lifetime_budget = String(input.budgetCents);
  }
  if (input.startTime) payload.start_time = input.startTime;
  if (input.endTime) payload.end_time = input.endTime;

  // Promoted object — only include if at least one field is set. Meta uses
  // different keys depending on what you're optimizing for; we forward
  // whatever the caller provided.
  if (input.promotedObject) {
    const po: Record<string, unknown> = {};
    if (input.promotedObject.pixelId) po.pixel_id = input.promotedObject.pixelId;
    if (input.promotedObject.customEventType) {
      po.custom_event_type = input.promotedObject.customEventType;
    }
    if (input.promotedObject.pageId) po.page_id = input.promotedObject.pageId;
    if (input.promotedObject.applicationId) {
      po.application_id = input.promotedObject.applicationId;
    }
    if (input.promotedObject.objectStoreUrl) {
      po.object_store_url = input.promotedObject.objectStoreUrl;
    }
    if (Object.keys(po).length > 0) {
      payload.promoted_object = po;
    }
  }

  let createResult: { id: string };
  try {
    createResult = await metaClient.createAdSet(
      campaign.adAccount.business.connection.id,
      campaign.adAccount.metaAdAccountId,
      payload,
    );
  } catch (err) {
    const message =
      err instanceof MetaApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    await prisma.auditLog.update({
      where: { id: auditRow.id },
      data: {
        after: {
          ...intent,
          _failed: true,
          _error: message,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    throw err;
  }

  // Local insert. Targeting fields aren't stored locally yet — sync will
  // bring them when we extend the AdSet model.
  const adSet = await prisma.adSet.create({
    data: {
      metaAdSetId: createResult.id,
      adAccountId: campaign.adAccountId,
      campaignId: campaign.id,
      name,
      status: input.status,
      optimizationGoal: input.optimizationGoal,
      dailyBudgetCents:
        input.budgetType === "daily" ? (input.budgetCents ?? null) : null,
      lifetimeBudgetCents:
        input.budgetType === "lifetime" ? (input.budgetCents ?? null) : null,
      metaUpdatedTime: new Date(),
    },
  });

  await prisma.auditLog.update({
    where: { id: auditRow.id },
    data: {
      targetId: createResult.id,
      after: {
        ...intent,
        metaAdSetId: createResult.id,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    metaAdSetId: createResult.id,
    adSetId: adSet.id,
  };
}
