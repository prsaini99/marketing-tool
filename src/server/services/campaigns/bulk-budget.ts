/**
 * Bulk budget change across many campaigns — riskiest bulk op, fully
 * audit-logged.
 *
 * Two axes the caller picks:
 *   budgetType: "daily" | "lifetime"   — which field on Meta to change
 *   mode:       "absolute" | "percent" — how to compute the new value
 *
 * Eligibility = the campaign has a value for that budget type.
 * (A campaign uses ONE budget type at a time; "daily" edit skips lifetime
 *  campaigns and vice versa.)
 *
 * Per-campaign flow:
 *   1. AuditLog row written BEFORE Meta call (records intent)
 *   2. Compute newCents per mode
 *   3. Fire metaClient.updateCampaignBudget
 *   4. Mirror result to local Campaign row on success
 *   5. Stamp AuditLog with success/failure
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export type BudgetType = "daily" | "lifetime";

export interface BulkBudgetInput {
  metaCampaignIds: string[];
  budgetType: BudgetType;
  // Exactly one of these two:
  setAbsoluteCents?: number;
  adjustPercent?: number; // e.g. 20 for +20%, -10 for -10%
}

export interface BulkBudgetItemResult {
  metaCampaignId: string;
  status: "ok" | "failed" | "skipped";
  fromCents?: number;
  toCents?: number;
  reason?: string;
}

export interface BulkBudgetResult {
  total: number;
  ok: number;
  failed: number;
  skipped: number;
  items: BulkBudgetItemResult[];
}

function computeNewCents(
  currentCents: number,
  input: BulkBudgetInput,
): number {
  if (input.setAbsoluteCents != null) {
    return Math.round(input.setAbsoluteCents);
  }
  if (input.adjustPercent != null) {
    const factor = 1 + input.adjustPercent / 100;
    return Math.max(1, Math.round(currentCents * factor));
  }
  throw new Error("Either setAbsoluteCents or adjustPercent must be provided");
}

export async function bulkUpdateCampaignBudget(
  input: BulkBudgetInput,
): Promise<BulkBudgetResult> {
  const ids = input.metaCampaignIds.filter(Boolean);
  if (ids.length === 0) throw new Error("No campaigns to update");
  if (ids.length > 100) {
    throw new Error(
      "Bulk limit is 100 campaigns per request. Split into smaller batches.",
    );
  }
  if (input.budgetType !== "daily" && input.budgetType !== "lifetime") {
    throw new Error("budgetType must be 'daily' or 'lifetime'");
  }
  const hasAbsolute = input.setAbsoluteCents != null;
  const hasPercent = input.adjustPercent != null;
  if (hasAbsolute === hasPercent) {
    throw new Error(
      "Provide exactly one of setAbsoluteCents or adjustPercent",
    );
  }
  if (
    hasAbsolute &&
    (input.setAbsoluteCents! <= 0 || !Number.isFinite(input.setAbsoluteCents!))
  ) {
    throw new Error("setAbsoluteCents must be a positive number");
  }
  if (hasPercent && !Number.isFinite(input.adjustPercent!)) {
    throw new Error("adjustPercent must be a finite number");
  }

  const campaigns = await prisma.campaign.findMany({
    where: {
      metaCampaignId: { in: ids },
      adAccount: { selectedForSync: true },
    },
    include: {
      adAccount: { include: { business: { include: { connection: true } } } },
    },
  });
  const byMetaId = new Map(campaigns.map((c) => [c.metaCampaignId, c]));
  const items: BulkBudgetItemResult[] = [];

  const fieldKey =
    input.budgetType === "daily" ? "dailyBudgetCents" : "lifetimeBudgetCents";

  for (const requestedId of ids) {
    const c = byMetaId.get(requestedId);
    if (!c) {
      items.push({
        metaCampaignId: requestedId,
        status: "skipped",
        reason: "Campaign not found in selected accounts",
      });
      continue;
    }
    const currentCents =
      input.budgetType === "daily"
        ? c.dailyBudgetCents
        : c.lifetimeBudgetCents;
    if (currentCents == null) {
      items.push({
        metaCampaignId: c.metaCampaignId,
        status: "skipped",
        reason:
          input.budgetType === "daily"
            ? "Campaign has no daily budget (lifetime or CBO)"
            : "Campaign has no lifetime budget (daily or CBO)",
      });
      continue;
    }

    const fromCents = currentCents;
    let toCents: number;
    try {
      toCents = computeNewCents(fromCents, input);
    } catch (err) {
      items.push({
        metaCampaignId: c.metaCampaignId,
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (toCents === fromCents) {
      items.push({
        metaCampaignId: c.metaCampaignId,
        status: "skipped",
        fromCents,
        toCents,
        reason: "Budget unchanged",
      });
      continue;
    }

    const auditRow = await prisma.auditLog.create({
      data: {
        action: "campaign.budget_update",
        targetType: "campaign",
        targetId: c.metaCampaignId,
        before: { [fieldKey]: fromCents },
        after: { [fieldKey]: toCents, _pending: true },
      },
    });

    try {
      await metaClient.updateCampaignBudget(
        c.adAccount.business.connection.id,
        c.metaCampaignId,
        input.budgetType,
        toCents,
      );
      await prisma.campaign.update({
        where: { id: c.id },
        data: { [fieldKey]: toCents },
      });
      await prisma.auditLog.update({
        where: { id: auditRow.id },
        data: { after: { [fieldKey]: toCents } },
      });
      items.push({
        metaCampaignId: c.metaCampaignId,
        status: "ok",
        fromCents,
        toCents,
      });
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
            [fieldKey]: fromCents,
            _failed: true,
            _error: message,
          },
        },
      });
      items.push({
        metaCampaignId: c.metaCampaignId,
        status: "failed",
        fromCents,
        toCents,
        reason: message,
      });
    }
  }

  return {
    total: ids.length,
    ok: items.filter((i) => i.status === "ok").length,
    failed: items.filter((i) => i.status === "failed").length,
    skipped: items.filter((i) => i.status === "skipped").length,
    items,
  };
}
