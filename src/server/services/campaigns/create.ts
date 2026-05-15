/**
 * Create a new campaign on Meta + mirror it locally.
 *
 * Mirrors the per-bulk-op safety pattern:
 *   1. AuditLog row written BEFORE the Meta call (records intent — visible
 *      in the audit log page even if Meta rejects the create).
 *   2. Fire Meta POST.
 *   3. On success: insert a Campaign row locally so the UI sees the new
 *      campaign immediately (no need to wait for the next sync).
 *   4. Stamp the audit row with the new Meta id.
 *
 * Field set follows what Meta requires today (Sep 2025):
 *   • name, objective, status, special_ad_categories (always sent)
 *   • daily_budget / lifetime_budget + bid_strategy when CBO is on
 *   • stop_time when budgetType = lifetime
 *   • spend_cap optional
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export interface CreateCampaignInput {
  // Meta ad account id, act_-prefixed.
  metaAdAccountId: string;
  name: string;
  objective: string; // e.g. "OUTCOME_SALES"
  status: "PAUSED" | "ACTIVE";
  // Empty array = "None". Meta requires the field be sent even when empty.
  specialAdCategories: string[];
  // null = CBO off (budget set later per ad set).
  budgetType: "daily" | "lifetime" | null;
  budgetCents?: number; // required when budgetType is set
  // Required when budgetType is set; defaults to LOWEST_COST_WITHOUT_CAP at
  // the API layer if not provided.
  bidStrategy?: string;
  spendCapCents?: number; // optional campaign-wide spend cap
  stopTime?: string; // ISO 8601; required when budgetType = "lifetime"
}

export interface CreateCampaignResult {
  metaCampaignId: string;
  // Local Prisma id of the inserted Campaign row.
  campaignId: string;
}

export async function createCampaign(
  input: CreateCampaignInput,
): Promise<CreateCampaignResult> {
  const name = input.name?.trim();
  if (!name) throw new Error("name is required");
  if (!input.objective) throw new Error("objective is required");
  if (input.status !== "PAUSED" && input.status !== "ACTIVE") {
    throw new Error("status must be 'PAUSED' or 'ACTIVE'");
  }
  if (input.budgetType) {
    if (!input.budgetCents || input.budgetCents <= 0) {
      throw new Error("budgetCents must be > 0 when budgetType is set");
    }
    if (input.budgetType === "lifetime" && !input.stopTime) {
      throw new Error("stopTime is required for lifetime budgets");
    }
  }

  const account = await prisma.metaAdAccount.findFirst({
    where: {
      metaAdAccountId: input.metaAdAccountId,
      selectedForSync: true,
    },
    include: {
      business: { include: { connection: true } },
    },
  });
  if (!account) {
    throw new Error("Ad account not found or not selected for sync");
  }

  const intent = {
    name,
    objective: input.objective,
    status: input.status,
    specialAdCategories: input.specialAdCategories,
    budgetType: input.budgetType,
    budgetCents: input.budgetCents ?? null,
    bidStrategy: input.bidStrategy ?? null,
    spendCapCents: input.spendCapCents ?? null,
    stopTime: input.stopTime ?? null,
  };

  // 1. AuditLog BEFORE Meta call. targetId is "(pending)" until Meta returns
  //    the id — we update it on success.
  const auditRow = await prisma.auditLog.create({
    data: {
      action: "campaign.create",
      targetType: "campaign",
      targetId: "(pending)",
      before: {},
      after: { ...intent, _pending: true },
    },
  });

  // 2. Build Meta payload — only forward fields that apply.
  const payload: Record<string, unknown> = {
    name,
    objective: input.objective,
    status: input.status,
    special_ad_categories: input.specialAdCategories,
  };
  if (input.budgetType === "daily") {
    payload.daily_budget = String(input.budgetCents);
  }
  if (input.budgetType === "lifetime") {
    payload.lifetime_budget = String(input.budgetCents);
    payload.stop_time = input.stopTime;
  }
  if (input.budgetType) {
    // Meta requires bid_strategy on CBO campaigns; default to highest volume.
    payload.bid_strategy = input.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP";
  }
  if (input.spendCapCents && input.spendCapCents > 0) {
    payload.spend_cap = String(input.spendCapCents);
  }

  let createResult: { id: string };
  try {
    createResult = await metaClient.createCampaign(
      account.business.connection.id,
      account.metaAdAccountId,
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
        after: { ...intent, _failed: true, _error: message },
      },
    });
    throw err;
  }

  // 3. Local insert — fields we already know. metaUpdatedTime defaults to
  //    now; next sync will refresh with Meta's authoritative value.
  const campaign = await prisma.campaign.create({
    data: {
      metaCampaignId: createResult.id,
      adAccountId: account.id,
      name,
      status: input.status,
      objective: input.objective,
      dailyBudgetCents:
        input.budgetType === "daily" ? (input.budgetCents ?? null) : null,
      lifetimeBudgetCents:
        input.budgetType === "lifetime" ? (input.budgetCents ?? null) : null,
      metaUpdatedTime: new Date(),
    },
  });

  // 4. Stamp the audit row with the resolved id.
  await prisma.auditLog.update({
    where: { id: auditRow.id },
    data: {
      targetId: createResult.id,
      after: { ...intent, metaCampaignId: createResult.id },
    },
  });

  return {
    metaCampaignId: createResult.id,
    campaignId: campaign.id,
  };
}
