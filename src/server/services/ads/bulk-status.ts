/**
 * Bulk ad status change — mirrors campaigns/bulk-status.ts.
 * Ads don't have budgets, so this is the only bulk write for ads.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export type AdBulkAction = "pause" | "activate" | "archive";

const ACTION_TO_META_STATUS: Record<
  AdBulkAction,
  "PAUSED" | "ACTIVE" | "ARCHIVED"
> = {
  pause: "PAUSED",
  activate: "ACTIVE",
  archive: "ARCHIVED",
};

const ACTION_TO_AUDIT_VERB: Record<AdBulkAction, string> = {
  pause: "ad.pause",
  activate: "ad.activate",
  archive: "ad.archive",
};

export interface AdBulkStatusInput {
  action: AdBulkAction;
  metaAdIds: string[];
}

export interface AdBulkStatusItemResult {
  metaAdId: string;
  status: "ok" | "failed" | "skipped";
  reason?: string;
}

export interface AdBulkStatusResult {
  action: AdBulkAction;
  total: number;
  ok: number;
  failed: number;
  skipped: number;
  items: AdBulkStatusItemResult[];
}

export async function bulkChangeAdStatus(
  input: AdBulkStatusInput,
): Promise<AdBulkStatusResult> {
  const ids = input.metaAdIds.filter(Boolean);
  if (ids.length === 0) throw new Error("No ads to update");
  if (ids.length > 100) {
    throw new Error(
      "Bulk limit is 100 ads per request. Split into smaller batches.",
    );
  }

  const ads = await prisma.ad.findMany({
    where: {
      metaAdId: { in: ids },
      adAccount: { selectedForSync: true },
    },
    include: {
      adAccount: { include: { business: { include: { connection: true } } } },
    },
  });

  const byMetaId = new Map(ads.map((a) => [a.metaAdId, a]));
  const newMetaStatus = ACTION_TO_META_STATUS[input.action];
  const auditVerb = ACTION_TO_AUDIT_VERB[input.action];

  const items: AdBulkStatusItemResult[] = [];

  for (const requestedId of ids) {
    const a = byMetaId.get(requestedId);
    if (!a) {
      items.push({
        metaAdId: requestedId,
        status: "skipped",
        reason: "Ad not found in selected accounts",
      });
      continue;
    }
    if (a.status === newMetaStatus) {
      items.push({
        metaAdId: a.metaAdId,
        status: "skipped",
        reason: `Already ${newMetaStatus.toLowerCase()}`,
      });
      continue;
    }

    const auditRow = await prisma.auditLog.create({
      data: {
        action: auditVerb,
        targetType: "ad",
        targetId: a.metaAdId,
        before: { status: a.status },
        after: { status: newMetaStatus, _pending: true },
      },
    });

    try {
      await metaClient.updateAdStatus(
        a.adAccount.business.connection.id,
        a.metaAdId,
        newMetaStatus,
      );
      await prisma.ad.update({
        where: { id: a.id },
        data: { status: newMetaStatus },
      });
      await prisma.auditLog.update({
        where: { id: auditRow.id },
        data: { after: { status: newMetaStatus } },
      });
      items.push({ metaAdId: a.metaAdId, status: "ok" });
    } catch (err) {
      const message =
        err instanceof MetaApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unknown error";
      await prisma.auditLog.update({
        where: { id: auditRow.id },
        data: { after: { status: a.status, _failed: true, _error: message } },
      });
      items.push({
        metaAdId: a.metaAdId,
        status: "failed",
        reason: message,
      });
    }
  }

  return {
    action: input.action,
    total: ids.length,
    ok: items.filter((i) => i.status === "ok").length,
    failed: items.filter((i) => i.status === "failed").length,
    skipped: items.filter((i) => i.status === "skipped").length,
    items,
  };
}
