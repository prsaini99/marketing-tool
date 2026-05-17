/**
 * Pulls saved custom conversions for one ad account from Meta and upserts
 * them into our CustomConversion table.
 *
 *   • Bail if the account isn't selectedForSync.
 *   • Open a SyncLog row, run the call, stamp success/failure.
 *   • Upsert by (adAccountId, metaConversionId) for idempotency.
 *
 * Same shape as sync-audiences.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient } from "@/lib/meta/client";

export interface SyncConversionsResult {
  adAccountId: string;
  upserted: number;
  syncLogId: string;
}

export async function syncConversionsForAccount(
  adAccountId: string,
): Promise<SyncConversionsResult> {
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
      kind: "conversions",
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    const conversions = await metaClient.listCustomConversions(
      account.business.connection.id,
      account.metaAdAccountId,
    );

    let upserted = 0;
    for (const c of conversions) {
      await prisma.customConversion.upsert({
        where: {
          adAccountId_metaConversionId: {
            adAccountId: account.id,
            metaConversionId: c.id,
          },
        },
        create: {
          adAccountId: account.id,
          metaConversionId: c.id,
          name: c.name,
          description: c.description,
          rule: c.rule,
          customEventType: c.customEventType,
          eventSourceId: c.eventSourceId,
          metaLastFiredTime: c.lastFiredTime,
          metaCreatedTime: c.createdTime,
          syncedAt: new Date(),
        },
        update: {
          name: c.name,
          description: c.description,
          rule: c.rule,
          customEventType: c.customEventType,
          eventSourceId: c.eventSourceId,
          metaLastFiredTime: c.lastFiredTime,
          metaCreatedTime: c.createdTime,
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
