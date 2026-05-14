/**
 * Bulk ad-set status change — mirrors campaigns/bulk-status.ts.
 * Same flow: AuditLog before Meta call, mirror local state, stamp audit row.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export type AdSetBulkAction = "pause" | "activate" | "archive";

const ACTION_TO_META_STATUS: Record<
  AdSetBulkAction,
  "PAUSED" | "ACTIVE" | "ARCHIVED"
> = {
  pause: "PAUSED",
  activate: "ACTIVE",
  archive: "ARCHIVED",
};

const ACTION_TO_AUDIT_VERB: Record<AdSetBulkAction, string> = {
  pause: "adset.pause",
  activate: "adset.activate",
  archive: "adset.archive",
};

export interface AdSetBulkStatusInput {
  action: AdSetBulkAction;
  metaAdSetIds: string[];
}

export interface AdSetBulkStatusItemResult {
  metaAdSetId: string;
  status: "ok" | "failed" | "skipped";
  reason?: string;
}

export interface AdSetBulkStatusResult {
  action: AdSetBulkAction;
  total: number;
  ok: number;
  failed: number;
  skipped: number;
  items: AdSetBulkStatusItemResult[];
}

export async function bulkChangeAdSetStatus(
  input: AdSetBulkStatusInput,
): Promise<AdSetBulkStatusResult> {
  const ids = input.metaAdSetIds.filter(Boolean);
  if (ids.length === 0) throw new Error("No ad sets to update");
  if (ids.length > 100) {
    throw new Error(
      "Bulk limit is 100 ad sets per request. Split into smaller batches.",
    );
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
  const newMetaStatus = ACTION_TO_META_STATUS[input.action];
  const auditVerb = ACTION_TO_AUDIT_VERB[input.action];

  const items: AdSetBulkStatusItemResult[] = [];

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
    if (s.status === newMetaStatus) {
      items.push({
        metaAdSetId: s.metaAdSetId,
        status: "skipped",
        reason: `Already ${newMetaStatus.toLowerCase()}`,
      });
      continue;
    }

    const auditRow = await prisma.auditLog.create({
      data: {
        action: auditVerb,
        targetType: "adset",
        targetId: s.metaAdSetId,
        before: { status: s.status },
        after: { status: newMetaStatus, _pending: true },
      },
    });

    try {
      await metaClient.updateAdSetStatus(
        s.adAccount.business.connection.id,
        s.metaAdSetId,
        newMetaStatus,
      );
      await prisma.adSet.update({
        where: { id: s.id },
        data: { status: newMetaStatus },
      });
      await prisma.auditLog.update({
        where: { id: auditRow.id },
        data: { after: { status: newMetaStatus } },
      });
      items.push({ metaAdSetId: s.metaAdSetId, status: "ok" });
    } catch (err) {
      const message =
        err instanceof MetaApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unknown error";
      await prisma.auditLog.update({
        where: { id: auditRow.id },
        data: { after: { status: s.status, _failed: true, _error: message } },
      });
      items.push({
        metaAdSetId: s.metaAdSetId,
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
