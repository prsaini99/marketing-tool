/**
 * Pulls 7 days of insights for one ad account at all 4 levels and upserts.
 *
 * Phase 1.2 scope: last 7 days, daily granularity, 4 levels (account /
 * campaign / adset / ad). Phase 1.3 will extend to 90-day backfill plus
 * a daily cron with rolling 7-day re-pull (Meta backfills attribution
 * for ~28 days post-event).
 *
 * Idempotency: upsert by (adAccountId, date, level, entityId). Running the
 * same sync twice produces the same DB state.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient } from "@/lib/meta/client";
import type { NormalizedInsight } from "@/lib/meta/types";

// Phase 1.2 default: pull 90 days on each sync. Phase 1.3's cron will narrow
// this to a rolling 7-day re-pull (Meta backfills attribution ~28 days).
const WINDOW_DAYS = 90;

export interface SyncInsightsResult {
  adAccountId: string;
  upserted: number;
  syncLogId: string;
  windowSince: string;
  windowUntil: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface SyncInsightsOptions {
  /**
   * Explicit window, ISO yyyy-mm-dd. Omit for the routine rolling window.
   *
   * THIS EXISTS BECAUSE THE ROLLING WINDOW LOSES HISTORY. The routine sync
   * asks Meta for the last WINDOW_DAYS only, so any delivery older than that
   * on the day of the FIRST sync is never collected, and every later run
   * moves the window further past it. On the account this was found on, the
   * first sync happened around mid-May, so Meta's delivery from 12 January
   * to 13 February was already out of reach on day one: 14,276.15 of real
   * spend across 16 campaigns that the dashboard has been rendering as zero
   * ever since.
   *
   * Meta retains insights for roughly 37 months, so that history is
   * recoverable. It just has to be asked for explicitly.
   */
  since?: string;
  until?: string;
}

export async function syncInsightsForAccount(
  adAccountId: string,
  opts: SyncInsightsOptions = {},
): Promise<SyncInsightsResult> {
  const account = await prisma.metaAdAccount.findUnique({
    where: { id: adAccountId },
    include: { business: { include: { connection: true } } },
  });
  if (!account) throw new Error(`Ad account not found: ${adAccountId}`);
  if (!account.selectedForSync) {
    throw new Error(`Ad account ${adAccountId} is not selected for sync`);
  }

  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - (WINDOW_DAYS - 1));

  const sinceStr = opts.since ?? isoDate(since);
  const untilStr = opts.until ?? isoDate(until);
  if (sinceStr > untilStr) {
    throw new Error(`Invalid window: since ${sinceStr} is after until ${untilStr}`);
  }

  const syncLog = await prisma.syncLog.create({
    data: {
      adAccountId: account.id,
      kind: "insights",
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    // 4 Meta calls — one per level. Done in parallel; each is a single
    // paginated GET against /act_X/insights with the appropriate `level`.
    const [acct, camp, adset, ad] = await Promise.all([
      metaClient.listInsights(
        account.business.connection.id,
        account.metaAdAccountId,
        "account",
        sinceStr,
        untilStr,
      ),
      metaClient.listInsights(
        account.business.connection.id,
        account.metaAdAccountId,
        "campaign",
        sinceStr,
        untilStr,
      ),
      metaClient.listInsights(
        account.business.connection.id,
        account.metaAdAccountId,
        "adset",
        sinceStr,
        untilStr,
      ),
      metaClient.listInsights(
        account.business.connection.id,
        account.metaAdAccountId,
        "ad",
        sinceStr,
        untilStr,
      ),
    ]);

    // Account-level rows don't have an entityId from the API — backfill it
    // here so the unique key (adAccountId, date, level, entityId) is well-defined.
    const acctRows: NormalizedInsight[] = acct.map((r) => ({
      ...r,
      entityId: account.metaAdAccountId,
    }));

    const all = [...acctRows, ...camp, ...adset, ...ad];

    let upserted = 0;
    for (const r of all) {
      if (!r.entityId) continue;
      await prisma.insightsSnapshot.upsert({
        where: {
          adAccountId_date_level_entityId: {
            adAccountId: account.id,
            date: new Date(r.date),
            level: r.level,
            entityId: r.entityId,
          },
        },
        create: {
          adAccountId: account.id,
          date: new Date(r.date),
          level: r.level,
          entityId: r.entityId,
          impressions: r.impressions,
          reach: r.reach,
          clicks: r.clicks,
          spendCents: r.spendCents,
          ctr: r.ctr,
          cpmCents: r.cpmCents,
          conversionsCount: r.conversionsCount,
          revenueCents: r.revenueCents,
          syncedAt: new Date(),
        },
        update: {
          impressions: r.impressions,
          reach: r.reach,
          clicks: r.clicks,
          spendCents: r.spendCents,
          ctr: r.ctr,
          cpmCents: r.cpmCents,
          conversionsCount: r.conversionsCount,
          revenueCents: r.revenueCents,
          syncedAt: new Date(),
        },
      });
      upserted++;
    }

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: "success", finishedAt: new Date() },
    });
    return {
      adAccountId: account.id,
      upserted,
      syncLogId: syncLog.id,
      windowSince: sinceStr,
      windowUntil: untilStr,
    };
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
