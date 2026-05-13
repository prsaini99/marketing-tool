/**
 * Pulls ads for one ad account from Meta and upserts them.
 *
 * Each ad references a parent ad set by Meta's adset_id. Local AdSet rows
 * must exist first (run adsets sync). Ads pointing to unknown ad sets are
 * skipped. Idempotent: upsert by (adAccountId, metaAdId).
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient } from "@/lib/meta/client";

export interface SyncAdsResult {
  adAccountId: string;
  upserted: number;
  skipped: number;
  syncLogId: string;
}

export async function syncAdsForAccount(
  adAccountId: string,
): Promise<SyncAdsResult> {
  const account = await prisma.metaAdAccount.findUnique({
    where: { id: adAccountId },
    include: { business: { include: { connection: true } } },
  });
  if (!account) throw new Error(`Ad account not found: ${adAccountId}`);
  if (!account.selectedForSync) {
    throw new Error(`Ad account ${adAccountId} is not selected for sync`);
  }

  const syncLog = await prisma.syncLog.create({
    data: {
      adAccountId: account.id,
      kind: "ads",
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    const ads = await metaClient.listAds(
      account.business.connection.id,
      account.metaAdAccountId,
    );

    const adSets = await prisma.adSet.findMany({
      where: { adAccountId: account.id },
      select: { id: true, metaAdSetId: true },
    });
    const adSetIdByMeta = new Map(adSets.map((s) => [s.metaAdSetId, s.id]));

    let upserted = 0;
    let skipped = 0;
    for (const a of ads) {
      const localAdSetId = adSetIdByMeta.get(a.adSetMetaId);
      if (!localAdSetId) {
        skipped++;
        continue;
      }
      await prisma.ad.upsert({
        where: {
          adAccountId_metaAdId: {
            adAccountId: account.id,
            metaAdId: a.id,
          },
        },
        create: {
          adAccountId: account.id,
          adSetId: localAdSetId,
          metaAdId: a.id,
          name: a.name,
          status: a.status,
          format: a.format,
          metaUpdatedTime: a.metaUpdatedTime,
          syncedAt: new Date(),
        },
        update: {
          adSetId: localAdSetId,
          name: a.name,
          status: a.status,
          format: a.format,
          metaUpdatedTime: a.metaUpdatedTime,
          syncedAt: new Date(),
        },
      });
      upserted++;
    }

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: "success", finishedAt: new Date() },
    });
    return { adAccountId: account.id, upserted, skipped, syncLogId: syncLog.id };
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
