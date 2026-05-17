/**
 * Pulls ad creatives for one ad account from Meta and upserts them into our
 * AdCreative table. Mirrors the pattern of sync-campaigns / sync-ads / etc.:
 *
 *   • Bail if the account isn't selectedForSync.
 *   • Open a SyncLog row, run the call, stamp success/failure.
 *   • Upsert by (adAccountId, metaCreativeId) so re-syncs are idempotent
 *     and historical AdCreative.id values stay stable.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient } from "@/lib/meta/client";

export interface SyncCreativesResult {
  adAccountId: string;
  upserted: number;
  syncLogId: string;
}

export async function syncCreativesForAccount(
  adAccountId: string,
): Promise<SyncCreativesResult> {
  const account = await prisma.metaAdAccount.findUnique({
    where: { id: adAccountId },
    include: { business: { include: { connection: true } } },
  });

  if (!account) {
    throw new Error(`Ad account not found: ${adAccountId}`);
  }
  if (!account.selectedForSync) {
    throw new Error(`Ad account ${adAccountId} is not selected for sync`);
  }

  const syncLog = await prisma.syncLog.create({
    data: {
      adAccountId: account.id,
      kind: "creatives",
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    const creatives = await metaClient.listAdCreatives(
      account.business.connection.id,
      account.metaAdAccountId,
    );

    let upserted = 0;
    for (const c of creatives) {
      await prisma.adCreative.upsert({
        where: {
          adAccountId_metaCreativeId: {
            adAccountId: account.id,
            metaCreativeId: c.id,
          },
        },
        create: {
          adAccountId: account.id,
          metaCreativeId: c.id,
          name: c.name,
          body: c.body,
          title: c.title,
          linkUrl: c.linkUrl,
          imageUrl: c.imageUrl,
          imageHash: c.imageHash,
          thumbnailUrl: c.thumbnailUrl,
          videoId: c.videoId,
          callToActionType: c.callToActionType,
          status: c.status,
          effectiveStoryId: c.effectiveStoryId,
          pageId: c.pageId,
          instagramActorId: c.instagramActorId,
          objectType: c.objectType,
          syncedAt: new Date(),
        },
        update: {
          name: c.name,
          body: c.body,
          title: c.title,
          linkUrl: c.linkUrl,
          imageUrl: c.imageUrl,
          imageHash: c.imageHash,
          thumbnailUrl: c.thumbnailUrl,
          videoId: c.videoId,
          callToActionType: c.callToActionType,
          status: c.status,
          effectiveStoryId: c.effectiveStoryId,
          pageId: c.pageId,
          instagramActorId: c.instagramActorId,
          objectType: c.objectType,
          syncedAt: new Date(),
        },
      });
      upserted++;
    }

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: "success", finishedAt: new Date() },
    });

    return { adAccountId: account.id, upserted, syncLogId: syncLog.id };
  } catch (err) {
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}
