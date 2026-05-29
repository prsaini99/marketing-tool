/**
 * Edit an existing campaign on Meta + mirror the change locally.
 *
 * Same safety pattern as create.ts, adapted for an update:
 *   1. Resolve the local Campaign row (must live in a selected-for-sync
 *      account) — gives us the `before` snapshot for the audit log.
 *   2. Diff the requested changes against current values; only changed
 *      fields are sent to Meta. If nothing changed, no-op.
 *   3. AuditLog row BEFORE the Meta call (before = current values,
 *      after = intended values + _pending).
 *   4. POST to Meta.
 *   5. On success, update the local Campaign row + stamp the audit row.
 *
 * Editable fields: name, status (ACTIVE/PAUSED), budget (when the campaign
 * is CBO), spend cap. Objective is NOT editable — Meta locks it after
 * creation, so we don't accept it here.
 *
 * Status note: this intentionally accepts only ACTIVE / PAUSED. ARCHIVED is
 * a soft-delete handled by the dedicated bulk-status flow with its own
 * confirmation, keeping destructive-ish transitions out of the plain edit.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export interface UpdateCampaignInput {
  metaCampaignId: string;
  // Each field is optional — omit to leave unchanged. null is NOT used; the
  // caller sends only what it wants to change.
  name?: string;
  status?: "ACTIVE" | "PAUSED";
  // Budget edits only apply to CBO campaigns (budget at campaign level).
  budgetType?: "daily" | "lifetime";
  budgetCents?: number;
  // 0 is a valid "remove the cap" sentinel on Meta's side; we forward it.
  spendCapCents?: number;
}

export interface UpdateCampaignResult {
  metaCampaignId: string;
  changedFields: string[];
}

export async function updateCampaign(
  input: UpdateCampaignInput,
): Promise<UpdateCampaignResult> {
  const campaign = await prisma.campaign.findFirst({
    where: {
      metaCampaignId: input.metaCampaignId,
      adAccount: { selectedForSync: true },
    },
    include: {
      adAccount: { include: { business: { include: { connection: true } } } },
    },
  });
  if (!campaign) {
    throw new Error(
      "Campaign not found in any selected-for-sync account",
    );
  }

  const campaignHasCbo =
    campaign.dailyBudgetCents != null || campaign.lifetimeBudgetCents != null;

  // Build the Meta payload + a parallel record of the local-column changes,
  // sending only fields that actually differ from current values.
  const payload: Record<string, unknown> = {};
  const localUpdate: Record<string, unknown> = {};
  const changedFields: string[] = [];

  const trimmedName = input.name?.trim();
  if (trimmedName && trimmedName !== campaign.name) {
    payload.name = trimmedName;
    localUpdate.name = trimmedName;
    changedFields.push("name");
  }

  if (input.status && input.status !== campaign.status) {
    if (input.status !== "ACTIVE" && input.status !== "PAUSED") {
      throw new Error("status must be 'ACTIVE' or 'PAUSED'");
    }
    payload.status = input.status;
    localUpdate.status = input.status;
    changedFields.push("status");
  }

  // Budget — only meaningful on CBO campaigns. Guard so we don't try to set
  // a budget on a non-CBO campaign (Meta would reject; ad sets own budget).
  if (input.budgetType && input.budgetCents != null) {
    if (!campaignHasCbo) {
      throw new Error(
        "This campaign has no CBO budget — edit the ad set budgets instead",
      );
    }
    if (input.budgetCents <= 0) {
      throw new Error("budgetCents must be > 0");
    }
    const current =
      input.budgetType === "daily"
        ? campaign.dailyBudgetCents
        : campaign.lifetimeBudgetCents;
    if (current !== input.budgetCents) {
      if (input.budgetType === "daily") {
        payload.daily_budget = String(input.budgetCents);
        localUpdate.dailyBudgetCents = input.budgetCents;
      } else {
        payload.lifetime_budget = String(input.budgetCents);
        localUpdate.lifetimeBudgetCents = input.budgetCents;
      }
      changedFields.push("budget");
    }
  }

  if (
    input.spendCapCents != null &&
    input.spendCapCents !== (campaign.spendCapCents ?? 0)
  ) {
    payload.spend_cap = String(input.spendCapCents);
    localUpdate.spendCapCents = input.spendCapCents > 0 ? input.spendCapCents : null;
    changedFields.push("spendCap");
  }

  if (changedFields.length === 0) {
    return { metaCampaignId: campaign.metaCampaignId, changedFields: [] };
  }

  const before = {
    name: campaign.name,
    status: campaign.status,
    dailyBudgetCents: campaign.dailyBudgetCents,
    lifetimeBudgetCents: campaign.lifetimeBudgetCents,
    spendCapCents: campaign.spendCapCents,
  };
  const intent = { ...before, ...localUpdate };

  const auditRow = await prisma.auditLog.create({
    data: {
      action: "campaign.update",
      targetType: "campaign",
      targetId: campaign.metaCampaignId,
      before,
      after: { ...intent, _pending: true, _changedFields: changedFields },
    },
  });

  try {
    await metaClient.updateCampaign(
      campaign.adAccount.business.connection.id,
      campaign.metaCampaignId,
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
      data: { after: { ...intent, _failed: true, _error: message } },
    });
    throw err;
  }

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { ...localUpdate, metaUpdatedTime: new Date() },
  });

  await prisma.auditLog.update({
    where: { id: auditRow.id },
    data: { after: { ...intent, _changedFields: changedFields } },
  });

  return { metaCampaignId: campaign.metaCampaignId, changedFields };
}
