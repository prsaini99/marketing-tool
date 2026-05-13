/**
 * Bulk campaign status change — Pause / Activate / Archive across many
 * campaigns spanning many ad accounts and connections.
 *
 * Per-campaign flow:
 *   1. Resolve local Campaign row (must belong to a selected-for-sync account)
 *   2. Write an AuditLog row BEFORE the Meta call (records intent)
 *   3. Fire Meta API
 *   4. Update local Campaign.status so the UI reflects the change without
 *      waiting for the next sync
 *   5. Stamp AuditLog with success/failure
 *
 * Sequential by design — keeps per-account rate limits predictable and the
 * audit log linear. For very large bulks (>50) Phase 2 should add Inngest
 * (PROJECT.md rule #4).
 *
 * Returns a per-campaign result so the UI can show "8 paused, 2 failed".
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export type CampaignBulkAction = "pause" | "activate" | "archive";

const ACTION_TO_META_STATUS: Record<
  CampaignBulkAction,
  "PAUSED" | "ACTIVE" | "ARCHIVED"
> = {
  pause: "PAUSED",
  activate: "ACTIVE",
  archive: "ARCHIVED",
};

const ACTION_TO_AUDIT_VERB: Record<CampaignBulkAction, string> = {
  pause: "campaign.pause",
  activate: "campaign.activate",
  archive: "campaign.archive",
};

export interface BulkStatusInput {
  action: CampaignBulkAction;
  // Meta campaign ids (the entity ids from Meta, e.g. "23856789001")
  metaCampaignIds: string[];
}

export interface BulkStatusItemResult {
  metaCampaignId: string;
  status: "ok" | "failed" | "skipped";
  reason?: string;
}

export interface BulkStatusResult {
  action: CampaignBulkAction;
  total: number;
  ok: number;
  failed: number;
  skipped: number;
  items: BulkStatusItemResult[];
}

export async function bulkChangeCampaignStatus(
  input: BulkStatusInput,
): Promise<BulkStatusResult> {
  const ids = input.metaCampaignIds.filter(Boolean);
  if (ids.length === 0) {
    throw new Error("No campaigns to update");
  }
  if (ids.length > 100) {
    throw new Error(
      "Bulk limit is 100 campaigns per request. Split into smaller batches.",
    );
  }

  // Resolve every campaign in one query, including the chain we need.
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
  const newMetaStatus = ACTION_TO_META_STATUS[input.action];
  const auditVerb = ACTION_TO_AUDIT_VERB[input.action];

  const items: BulkStatusItemResult[] = [];

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

    // No-op skip: already in target state. Defense against race conditions
    // (user selected stale data, or two operators bulk-acted in parallel)
    // AND keeps us from hammering Meta with pointless writes.
    if (c.status === newMetaStatus) {
      items.push({
        metaCampaignId: c.metaCampaignId,
        status: "skipped",
        reason: `Already ${newMetaStatus.toLowerCase()}`,
      });
      continue;
    }

    // 1. AuditLog before the call — captures intent even if Meta fails.
    const auditRow = await prisma.auditLog.create({
      data: {
        action: auditVerb,
        targetType: "campaign",
        targetId: c.metaCampaignId,
        before: { status: c.status },
        after: { status: newMetaStatus, _pending: true },
      },
    });

    try {
      await metaClient.updateCampaignStatus(
        c.adAccount.business.connection.id,
        c.metaCampaignId,
        newMetaStatus,
      );

      // 2. Mirror Meta's new state locally so UI updates immediately.
      await prisma.campaign.update({
        where: { id: c.id },
        data: { status: newMetaStatus },
      });

      // 3. Stamp audit row with success.
      await prisma.auditLog.update({
        where: { id: auditRow.id },
        data: { after: { status: newMetaStatus } },
      });

      items.push({ metaCampaignId: c.metaCampaignId, status: "ok" });
    } catch (err) {
      const message =
        err instanceof MetaApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unknown error";

      // Mark audit row as failed (keep `before` for accountability).
      await prisma.auditLog.update({
        where: { id: auditRow.id },
        data: {
          after: { status: c.status, _failed: true, _error: message },
        },
      });

      items.push({
        metaCampaignId: c.metaCampaignId,
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
