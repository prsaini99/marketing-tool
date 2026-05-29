/**
 * Edit an existing ad set on Meta + mirror the change locally.
 *
 * Same safety pattern as campaigns/update.ts:
 *   1. Resolve the local AdSet row (must live in a selected-for-sync
 *      account) — gives us the `before` snapshot for the audit log.
 *   2. Diff requested changes against current values; send only the delta.
 *      No-op if nothing changed.
 *   3. AuditLog row BEFORE the Meta call.
 *   4. POST to Meta.
 *   5. On success, update the local AdSet row + stamp the audit row.
 *
 * Editable fields: name, status (ACTIVE/PAUSED), budget (daily/lifetime) —
 * the last only when the ad set OWNS its budget (campaign is not CBO).
 *
 * Deliberately NOT here:
 *   • optimization_goal — Meta locks it after the ad set starts delivering;
 *     surfacing it as editable would mostly produce confusing rejections.
 *   • targeting / schedule — not mirrored locally, so we can't diff them
 *     reliably. Editing those needs a live fetch-then-edit flow (separate
 *     task) so we don't silently clobber fields we never loaded.
 *   • ARCHIVED — soft-delete handled by the bulk-status flow with its own
 *     confirmation, kept out of plain edit.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export interface UpdateAdSetInput {
  metaAdSetId: string;
  name?: string;
  status?: "ACTIVE" | "PAUSED";
  budgetType?: "daily" | "lifetime";
  budgetCents?: number;
}

export interface UpdateAdSetResult {
  metaAdSetId: string;
  changedFields: string[];
}

export async function updateAdSet(
  input: UpdateAdSetInput,
): Promise<UpdateAdSetResult> {
  const adSet = await prisma.adSet.findFirst({
    where: {
      metaAdSetId: input.metaAdSetId,
      adAccount: { selectedForSync: true },
    },
    include: {
      adAccount: { include: { business: { include: { connection: true } } } },
    },
  });
  if (!adSet) {
    throw new Error("Ad set not found in any selected-for-sync account");
  }

  // The ad set owns its budget when it has one set locally. If both are null
  // the parent campaign is CBO and budget edits belong at campaign level.
  const adSetOwnsBudget =
    adSet.dailyBudgetCents != null || adSet.lifetimeBudgetCents != null;

  const payload: Record<string, unknown> = {};
  const localUpdate: Record<string, unknown> = {};
  const changedFields: string[] = [];

  const trimmedName = input.name?.trim();
  if (trimmedName && trimmedName !== adSet.name) {
    payload.name = trimmedName;
    localUpdate.name = trimmedName;
    changedFields.push("name");
  }

  if (input.status && input.status !== adSet.status) {
    if (input.status !== "ACTIVE" && input.status !== "PAUSED") {
      throw new Error("status must be 'ACTIVE' or 'PAUSED'");
    }
    payload.status = input.status;
    localUpdate.status = input.status;
    changedFields.push("status");
  }

  if (input.budgetType && input.budgetCents != null) {
    if (!adSetOwnsBudget) {
      throw new Error(
        "This ad set's budget is managed at the campaign level (CBO) — edit the campaign budget instead",
      );
    }
    if (input.budgetCents <= 0) {
      throw new Error("budgetCents must be > 0");
    }
    const current =
      input.budgetType === "daily"
        ? adSet.dailyBudgetCents
        : adSet.lifetimeBudgetCents;
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

  if (changedFields.length === 0) {
    return { metaAdSetId: adSet.metaAdSetId, changedFields: [] };
  }

  const before = {
    name: adSet.name,
    status: adSet.status,
    dailyBudgetCents: adSet.dailyBudgetCents,
    lifetimeBudgetCents: adSet.lifetimeBudgetCents,
  };
  const intent = { ...before, ...localUpdate };

  const auditRow = await prisma.auditLog.create({
    data: {
      action: "adset.update",
      targetType: "adset",
      targetId: adSet.metaAdSetId,
      before,
      after: { ...intent, _pending: true, _changedFields: changedFields },
    },
  });

  try {
    await metaClient.updateAdSet(
      adSet.adAccount.business.connection.id,
      adSet.metaAdSetId,
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

  await prisma.adSet.update({
    where: { id: adSet.id },
    data: { ...localUpdate, metaUpdatedTime: new Date() },
  });

  await prisma.auditLog.update({
    where: { id: auditRow.id },
    data: { after: { ...intent, _changedFields: changedFields } },
  });

  return { metaAdSetId: adSet.metaAdSetId, changedFields };
}
