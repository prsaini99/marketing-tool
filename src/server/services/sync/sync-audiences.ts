/**
 * Pulls saved custom audiences for one ad account from Meta and upserts
 * them into our CustomAudience table.
 *
 *   • Bail if the account isn't selectedForSync.
 *   • Open a SyncLog row, run the call, stamp success/failure.
 *   • Upsert by (adAccountId, metaAudienceId) so re-syncs are idempotent.
 *
 * Same shape as sync-creatives / sync-images / sync-videos.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient } from "@/lib/meta/client";

export interface SyncAudiencesResult {
  adAccountId: string;
  upserted: number;
  syncLogId: string;
}

export async function syncAudiencesForAccount(
  adAccountId: string,
): Promise<SyncAudiencesResult> {
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
      kind: "audiences",
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    const audiences = await metaClient.listCustomAudiences(
      account.business.connection.id,
      account.metaAdAccountId,
    );

    let upserted = 0;
    for (const a of audiences) {
      await prisma.customAudience.upsert({
        where: {
          adAccountId_metaAudienceId: {
            adAccountId: account.id,
            metaAudienceId: a.id,
          },
        },
        create: {
          adAccountId: account.id,
          metaAudienceId: a.id,
          name: a.name,
          subtype: a.subtype,
          description: a.description,
          approximateCount: a.approximateCount,
          operationStatus: a.operationStatus,
          dataSourceSubtype: a.dataSourceSubtype,
          metaCreatedTime: a.createdTime,
          syncedAt: new Date(),
        },
        update: {
          name: a.name,
          subtype: a.subtype,
          description: a.description,
          approximateCount: a.approximateCount,
          operationStatus: a.operationStatus,
          dataSourceSubtype: a.dataSourceSubtype,
          metaCreatedTime: a.createdTime,
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
