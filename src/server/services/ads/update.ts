/**
 * Edit an existing ad on Meta + mirror the change locally.
 *
 * Same safety pattern as campaigns/adsets update:
 *   1. Resolve the local Ad row (must live in a selected-for-sync account).
 *   2. Diff requested changes against current values; send only the delta.
 *   3. AuditLog row BEFORE the Meta call.
 *   4. POST to Meta.
 *   5. On success, update the local Ad row + stamp the audit row.
 *
 * Editable fields: name, status (ACTIVE/PAUSED), creative (swap to a
 * different existing creative by id). The new creative must already exist in
 * the same ad account — the caller picks from our synced AdCreative list.
 *
 * When the creative changes we also refresh the locally-stored
 * creativeThumbnailUrl from the chosen AdCreative so the ads tables show the
 * new thumbnail immediately without waiting for the next ads sync.
 *
 * ARCHIVED stays out of plain edit — handled by the bulk-status flow.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export interface UpdateAdInput {
  metaAdId: string;
  name?: string;
  status?: "ACTIVE" | "PAUSED";
  // New creative id to swap to. Must belong to the same ad account.
  metaCreativeId?: string;
}

export interface UpdateAdResult {
  metaAdId: string;
  changedFields: string[];
}

export async function updateAd(input: UpdateAdInput): Promise<UpdateAdResult> {
  const ad = await prisma.ad.findFirst({
    where: {
      metaAdId: input.metaAdId,
      adAccount: { selectedForSync: true },
    },
    include: {
      adAccount: { include: { business: { include: { connection: true } } } },
    },
  });
  if (!ad) {
    throw new Error("Ad not found in any selected-for-sync account");
  }

  const payload: Record<string, unknown> = {};
  const localUpdate: Record<string, unknown> = {};
  const changedFields: string[] = [];

  const trimmedName = input.name?.trim();
  if (trimmedName && trimmedName !== ad.name) {
    payload.name = trimmedName;
    localUpdate.name = trimmedName;
    changedFields.push("name");
  }

  if (input.status && input.status !== ad.status) {
    if (input.status !== "ACTIVE" && input.status !== "PAUSED") {
      throw new Error("status must be 'ACTIVE' or 'PAUSED'");
    }
    payload.status = input.status;
    localUpdate.status = input.status;
    changedFields.push("status");
  }

  if (input.metaCreativeId && input.metaCreativeId !== ad.metaCreativeId) {
    // Validate the new creative belongs to the same account — Meta would
    // reject a cross-account creative, but failing fast gives a clearer msg.
    const creative = await prisma.adCreative.findFirst({
      where: {
        adAccountId: ad.adAccountId,
        metaCreativeId: input.metaCreativeId,
      },
      select: { metaCreativeId: true, thumbnailUrl: true },
    });
    if (!creative) {
      throw new Error(
        "Selected creative isn't in this ad account — sync creatives and try again",
      );
    }
    payload.creative = { creative_id: input.metaCreativeId };
    localUpdate.metaCreativeId = input.metaCreativeId;
    localUpdate.creativeThumbnailUrl = creative.thumbnailUrl;
    changedFields.push("creative");
  }

  if (changedFields.length === 0) {
    return { metaAdId: ad.metaAdId, changedFields: [] };
  }

  const before = {
    name: ad.name,
    status: ad.status,
    metaCreativeId: ad.metaCreativeId,
  };
  const intent = { ...before, ...localUpdate };

  const auditRow = await prisma.auditLog.create({
    data: {
      action: "ad.update",
      targetType: "ad",
      targetId: ad.metaAdId,
      before,
      after: { ...intent, _pending: true, _changedFields: changedFields },
    },
  });

  try {
    await metaClient.updateAd(
      ad.adAccount.business.connection.id,
      ad.metaAdId,
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

  await prisma.ad.update({
    where: { id: ad.id },
    data: { ...localUpdate, metaUpdatedTime: new Date() },
  });

  await prisma.auditLog.update({
    where: { id: auditRow.id },
    data: { after: { ...intent, _changedFields: changedFields } },
  });

  return { metaAdId: ad.metaAdId, changedFields };
}
