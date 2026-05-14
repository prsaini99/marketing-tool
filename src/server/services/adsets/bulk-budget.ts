/**
 * Bulk ad-set budget change — mirrors campaigns/bulk-budget.ts.
 * Two axes: budgetType (daily|lifetime) × mode (absolute|percent).
 * Eligibility = ad set has a value for that budget type.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export type BudgetType = "daily" | "lifetime";

export interface AdSetBulkBudgetInput {
  metaAdSetIds: string[];
  budgetType: BudgetType;
  setAbsoluteCents?: number;
  adjustPercent?: number;
}

export interface AdSetBulkBudgetItemResult {
  metaAdSetId: string;
  status: "ok" | "failed" | "skipped";
  fromCents?: number;
  toCents?: number;
  reason?: string;
}

export interface AdSetBulkBudgetResult {
  total: number;
  ok: number;
  failed: number;
  skipped: number;
  items: AdSetBulkBudgetItemResult[];
}

function computeNewCents(
  currentCents: number,
  input: AdSetBulkBudgetInput,
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

export async function bulkUpdateAdSetBudget(
  input: AdSetBulkBudgetInput,
): Promise<AdSetBulkBudgetResult> {
  const ids = input.metaAdSetIds.filter(Boolean);
  if (ids.length === 0) throw new Error("No ad sets to update");
  if (ids.length > 100) {
    throw new Error(
      "Bulk limit is 100 ad sets per request. Split into smaller batches.",
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

  const adSets = await prisma.adSet.findMany({
    where: {
      metaAdSetId: { in: ids },
      adAccount: { selectedForSync: true },
    },
    include: {
      adAccount: { include: { business: { include: { connection: true } } } },
    },
  });
  const byMetaId = new Map(adSets.map((s) => [s.metaAdSetId, s]));
  const items: AdSetBulkBudgetItemResult[] = [];

  const fieldKey =
    input.budgetType === "daily" ? "dailyBudgetCents" : "lifetimeBudgetCents";

  for (const requestedId of ids) {
    const s = byMetaId.get(requestedId);
    if (!s) {
      items.push({
        metaAdSetId: requestedId,
        status: "skipped",
        reason: "Ad set not found in selected accounts",
      });
      continue;
    }
    const currentCents =
      input.budgetType === "daily"
        ? s.dailyBudgetCents
        : s.lifetimeBudgetCents;
    if (currentCents == null) {
      items.push({
        metaAdSetId: s.metaAdSetId,
        status: "skipped",
        reason:
          input.budgetType === "daily"
            ? "Ad set has no daily budget (lifetime or CBO)"
            : "Ad set has no lifetime budget (daily or CBO)",
      });
      continue;
    }

    const fromCents = currentCents;
    let toCents: number;
    try {
      toCents = computeNewCents(fromCents, input);
    } catch (err) {
      items.push({
        metaAdSetId: s.metaAdSetId,
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (toCents === fromCents) {
      items.push({
        metaAdSetId: s.metaAdSetId,
        status: "skipped",
        fromCents,
        toCents,
        reason: "Budget unchanged",
      });
      continue;
    }

    const auditRow = await prisma.auditLog.create({
      data: {
        action: "adset.budget_update",
        targetType: "adset",
        targetId: s.metaAdSetId,
        before: { [fieldKey]: fromCents },
        after: { [fieldKey]: toCents, _pending: true },
      },
    });

    try {
      await metaClient.updateAdSetBudget(
        s.adAccount.business.connection.id,
        s.metaAdSetId,
        input.budgetType,
        toCents,
      );
      await prisma.adSet.update({
        where: { id: s.id },
        data: { [fieldKey]: toCents },
      });
      await prisma.auditLog.update({
        where: { id: auditRow.id },
        data: { after: { [fieldKey]: toCents } },
      });
      items.push({
        metaAdSetId: s.metaAdSetId,
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
        metaAdSetId: s.metaAdSetId,
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
