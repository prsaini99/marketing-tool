/**
 * Pulls campaigns for one ad account from Meta and upserts them into our DB.
 *
 * Phase 1.0 scope: just the campaign metadata. Ad sets, ads, and insights
 * land in 1.1 / 1.2 — same pattern, different endpoints.
 *
 * Idempotency: upsert by (adAccountId, metaCampaignId). Re-running on the
 * same day is safe; rows update in place rather than duplicating.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient } from "@/lib/meta/client";

export interface SyncCampaignsResult {
  adAccountId: string;
  upserted: number;
  syncLogId: string;
}

export async function syncCampaignsForAccount(
  adAccountId: string,
): Promise<SyncCampaignsResult> {
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
      kind: "campaigns",
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    const campaigns = await metaClient.listCampaigns(
      account.business.connection.id,
      account.metaAdAccountId,
    );

    let upserted = 0;
    for (const c of campaigns) {
      await prisma.campaign.upsert({
        where: {
          adAccountId_metaCampaignId: {
            adAccountId: account.id,
            metaCampaignId: c.id,
          },
        },
        create: {
          adAccountId: account.id,
          metaCampaignId: c.id,
          name: c.name,
          status: c.status,
          objective: c.objective || null,
          dailyBudgetCents: c.dailyBudgetCents,
          lifetimeBudgetCents: c.lifetimeBudgetCents,
          spendCapCents: c.spendCapCents,
          metaUpdatedTime: c.metaUpdatedTime,
          syncedAt: new Date(),
        },
        update: {
          name: c.name,
          status: c.status,
          objective: c.objective || null,
          dailyBudgetCents: c.dailyBudgetCents,
          lifetimeBudgetCents: c.lifetimeBudgetCents,
          spendCapCents: c.spendCapCents,
          metaUpdatedTime: c.metaUpdatedTime,
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
