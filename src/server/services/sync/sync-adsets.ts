/**
 * Pulls ad sets for one ad account from Meta and upserts them.
 *
 * Each ad set references a parent campaign by Meta's campaign_id. We look up
 * the local Campaign row by (adAccountId, metaCampaignId) — if not found,
 * the ad set is skipped with a warning (campaigns sync probably needs to run
 * first). Idempotent: upsert by (adAccountId, metaAdSetId).
 */

import { prisma } from "@/lib/db/prisma";
import { decideSyncMode } from "./watermark";
import { metaClient } from "@/lib/meta/client";

export interface SyncAdSetsResult {
  adAccountId: string;
  upserted: number;
  skipped: number;
  syncLogId: string;
}

export async function syncAdSetsForAccount(
  adAccountId: string,
opts: { forceFull?: boolean } = {},
): Promise<SyncAdSetsResult> {
  const account = await prisma.metaAdAccount.findUnique({
    where: { id: adAccountId },
    include: { business: { include: { connection: true } } },
  });
  if (!account) throw new Error(`Ad account not found: ${adAccountId}`);
  if (!account.selectedForSync) {
    throw new Error(`Ad account ${adAccountId} is not selected for sync`);
  }

  // Incremental when we can, full when we must. Only a full pull notices an
  // object deleted on Meta, so decideSyncMode forces one periodically.
  const [lastSuccess, lastFull] = await Promise.all([
    prisma.syncLog.findFirst({
      where: { adAccountId: account.id, kind: "ad_sets", status: "success" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    prisma.syncLog.findFirst({
      where: {
        adAccountId: account.id,
        kind: "ad_sets",
        status: "success",
        fullPull: true,
      },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);
  const mode = decideSyncMode(
    {
      lastSuccessAt: lastSuccess?.finishedAt ?? null,
      lastFullAt: lastFull?.finishedAt ?? null,
    },
    new Date(),
    { forceFull: opts.forceFull },
  );

  const syncLog = await prisma.syncLog.create({
    data: {
      fullPull: mode.full,
      adAccountId: account.id,
      kind: "adsets",
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    const adSets = await metaClient.listAdSets(
      account.business.connection.id,
      account.metaAdAccountId,
      mode.since
    );

    // Pre-fetch all campaigns for this account so we can map meta_id → local_id.
    const campaigns = await prisma.campaign.findMany({
      where: { adAccountId: account.id },
      select: { id: true, metaCampaignId: true },
    });
    const campaignIdByMeta = new Map(
      campaigns.map((c) => [c.metaCampaignId, c.id]),
    );

    let upserted = 0;
    let skipped = 0;
    for (const s of adSets) {
      const localCampaignId = campaignIdByMeta.get(s.campaignMetaId);
      if (!localCampaignId) {
        skipped++;
        continue;
      }
      await prisma.adSet.upsert({
        where: {
          adAccountId_metaAdSetId: {
            adAccountId: account.id,
            metaAdSetId: s.id,
          },
        },
        create: {
          adAccountId: account.id,
          campaignId: localCampaignId,
          metaAdSetId: s.id,
          name: s.name,
          status: s.status,
          effectiveStatus: s.effectiveStatus,
          optimizationGoal: s.optimizationGoal,
          dailyBudgetCents: s.dailyBudgetCents,
          lifetimeBudgetCents: s.lifetimeBudgetCents,
          budgetRemainingCents: s.budgetRemainingCents,
          startTime: s.startTime,
          endTime: s.endTime,
          metaUpdatedTime: s.metaUpdatedTime,
          syncedAt: new Date(),
        },
        update: {
          campaignId: localCampaignId,
          name: s.name,
          status: s.status,
          effectiveStatus: s.effectiveStatus,
          optimizationGoal: s.optimizationGoal,
          dailyBudgetCents: s.dailyBudgetCents,
          lifetimeBudgetCents: s.lifetimeBudgetCents,
          budgetRemainingCents: s.budgetRemainingCents,
          startTime: s.startTime,
          endTime: s.endTime,
          metaUpdatedTime: s.metaUpdatedTime,
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
