/**
 * Pulls one ad account's live health fields (balance, spend cap, lifetime
 * spend, min daily budget, country, funding source, disable reason) from
 * Meta and mirrors them onto MetaAdAccount.
 *
 * Same pattern as the other sync kinds:
 *   • Bail if the account isn't selectedForSync.
 *   • Open a SyncLog row, run the call, stamp success/failure.
 *   • Idempotent — re-running just overwrites the latest values.
 *
 * These fields drift on Meta's side (balance ticks down as ads deliver,
 * top-ups clear, spend cap rises during reconciliation), so we surface
 * `healthSyncedAt` in the UI so the user can decide if they need to refresh.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient } from "@/lib/meta/client";

export interface SyncAccountDetailResult {
  adAccountId: string;
  syncLogId: string;
}

export async function syncAccountDetailForAccount(
  adAccountId: string,
): Promise<SyncAccountDetailResult> {
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
      kind: "account-detail",
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    const detail = await metaClient.getAdAccountDetail(
      account.business.connection.id,
      account.metaAdAccountId,
    );

    await prisma.metaAdAccount.update({
      where: { id: account.id },
      data: {
        balanceCents: detail.balanceCents,
        spendCapCents: detail.spendCapCents,
        amountSpentCents: detail.amountSpentCents,
        minDailyBudgetCents: detail.minDailyBudgetCents,
        fundingSourceId: detail.fundingSourceId,
        businessCountryCode: detail.businessCountryCode,
        disableReason: detail.disableReason,
        healthSyncedAt: new Date(),
      },
    });

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: "success", finishedAt: new Date() },
    });

    return { adAccountId: account.id, syncLogId: syncLog.id };
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
