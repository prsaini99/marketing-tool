/**
 * Build the structured data the weekly-report LLM call needs.
 *
 * Pulls InsightsSnapshot rows for the last 7 days and the prior 7 days,
 * aggregates them at the campaign level, joins names from the Campaign
 * table, and assembles a compact JSON blob the LLM can narrate around.
 *
 * Why structured (not raw rows): the LLM does best with a small,
 * pre-summarised view — totals, deltas, top/bottom rows — instead of having
 * to add up 100s of daily snapshots itself. Keeps prompt tokens cheap and
 * the resulting prose grounded.
 */

import { prisma } from "@/lib/db/prisma";

export interface CampaignRow {
  metaCampaignId: string;
  name: string;
  status: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  ctr: number; // 0..1
  cpmCents: number;
  cpcCents: number; // derived
  conversionsCount: number;
  revenueCents: number;
  roas: number; // derived: revenueCents / spendCents
}

export interface PeriodTotals {
  spendCents: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpmCents: number;
  cpcCents: number;
  conversionsCount: number;
  revenueCents: number;
  roas: number; // derived
}

export interface ReportContext {
  account: {
    name: string;
    businessName: string;
    currency: string;
    timezone: string;
  };
  periods: {
    /** Last 7 days, INCLUSIVE — e.g. 2026-05-29 → 2026-06-04. */
    current: { from: string; to: string };
    /** The 7 days before that — for week-on-week deltas. */
    previous: { from: string; to: string };
  };
  totals: {
    current: PeriodTotals;
    previous: PeriodTotals;
  };
  /** Campaigns with activity this period, sorted by spend desc. Cap at 12. */
  campaigns: CampaignRow[];
  /**
   * Full-roster summary so the LLM doesn't confuse "1 campaign had data" with
   * "1 campaign exists". Counts cover ALL campaigns mirrored locally; the
   * names list surfaces active campaigns that had NO delivery this window —
   * a legitimate "needs attention" signal (budget/audience/scheduling).
   */
  roster: {
    totalCampaigns: number;
    activeCampaigns: number;
    pausedCampaigns: number;
    activeWithoutActivity: number;
    /** Names of active-but-no-delivery campaigns (capped at 15 for prompt size). */
    activeWithoutActivitySample: string[];
  };
  /** Coverage info — lets the LLM hedge if data is thin. */
  coverage: {
    daysWithData: number;
    lastSyncedAt: string | null;
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

function totalsFor(
  rows: Array<{
    spendCents: number;
    impressions: number;
    clicks: number;
    conversionsCount: number;
    revenueCents: number;
  }>,
): PeriodTotals {
  let spend = 0;
  let impr = 0;
  let clicks = 0;
  let conv = 0;
  let rev = 0;
  for (const r of rows) {
    spend += r.spendCents;
    impr += r.impressions;
    clicks += r.clicks;
    conv += r.conversionsCount;
    rev += r.revenueCents;
  }
  return {
    spendCents: spend,
    impressions: impr,
    clicks,
    ctr: safeDiv(clicks, impr),
    cpmCents: Math.round(safeDiv(spend * 1000, impr)),
    cpcCents: Math.round(safeDiv(spend, clicks)),
    conversionsCount: conv,
    revenueCents: rev,
    roas: safeDiv(rev, spend),
  };
}

export async function buildWeeklyReportContext(
  metaAdAccountIdParam: string,
): Promise<ReportContext> {
  const metaAdAccountId = metaAdAccountIdParam.startsWith("act_")
    ? metaAdAccountIdParam
    : `act_${metaAdAccountIdParam}`;

  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId, selectedForSync: true },
    include: { business: { select: { name: true } } },
  });
  if (!account) {
    throw new Error("Ad account not found or not selected for sync");
  }

  // Anchor on the latest snapshot date we have — using "today" would
  // overstate week-on-week deltas when the sync hasn't run yet.
  const latest = await prisma.insightsSnapshot.findFirst({
    where: { adAccountId: account.id, level: "campaign" },
    orderBy: { date: "desc" },
    select: { date: true },
  });

  const anchor = latest?.date ?? new Date();
  const currentTo = new Date(anchor);
  const currentFrom = new Date(anchor);
  currentFrom.setDate(currentFrom.getDate() - 6); // inclusive 7-day window
  const previousTo = new Date(currentFrom);
  previousTo.setDate(previousTo.getDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setDate(previousFrom.getDate() - 6);

  const [currentRows, previousRows, lastSync, allCampaigns] = await Promise.all([
    prisma.insightsSnapshot.findMany({
      where: {
        adAccountId: account.id,
        level: "campaign",
        date: { gte: currentFrom, lte: currentTo },
      },
      select: {
        entityId: true,
        spendCents: true,
        impressions: true,
        clicks: true,
        conversionsCount: true,
        revenueCents: true,
        date: true,
      },
    }),
    prisma.insightsSnapshot.findMany({
      where: {
        adAccountId: account.id,
        level: "campaign",
        date: { gte: previousFrom, lte: previousTo },
      },
      select: {
        spendCents: true,
        impressions: true,
        clicks: true,
        conversionsCount: true,
        revenueCents: true,
      },
    }),
    prisma.syncLog.findFirst({
      where: { adAccountId: account.id, kind: "insights", status: "success" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    // Full roster — needed so "how many campaigns?" answers don't confuse
    // "campaigns with data this window" with the actual total.
    prisma.campaign.findMany({
      where: { adAccountId: account.id },
      select: { metaCampaignId: true, name: true, status: true },
    }),
  ]);

  // Group current period by campaign, then look up names in one query.
  const byCampaign = new Map<
    string,
    {
      spendCents: number;
      impressions: number;
      clicks: number;
      conversionsCount: number;
      revenueCents: number;
    }
  >();
  const daysSeen = new Set<string>();
  for (const r of currentRows) {
    daysSeen.add(isoDate(r.date));
    const agg = byCampaign.get(r.entityId) ?? {
      spendCents: 0,
      impressions: 0,
      clicks: 0,
      conversionsCount: 0,
      revenueCents: 0,
    };
    agg.spendCents += r.spendCents;
    agg.impressions += r.impressions;
    agg.clicks += r.clicks;
    agg.conversionsCount += r.conversionsCount;
    agg.revenueCents += r.revenueCents;
    byCampaign.set(r.entityId, agg);
  }

  const campaignIds = Array.from(byCampaign.keys());
  const campaigns =
    campaignIds.length > 0
      ? await prisma.campaign.findMany({
          where: {
            adAccountId: account.id,
            metaCampaignId: { in: campaignIds },
          },
          select: { metaCampaignId: true, name: true, status: true },
        })
      : [];
  const nameById = new Map(
    campaigns.map((c) => [c.metaCampaignId, c] as const),
  );

  const campaignRows: CampaignRow[] = campaignIds
    .map((id) => {
      const agg = byCampaign.get(id)!;
      const meta = nameById.get(id);
      return {
        metaCampaignId: id,
        name: meta?.name ?? id,
        status: meta?.status ?? "UNKNOWN",
        spendCents: agg.spendCents,
        impressions: agg.impressions,
        clicks: agg.clicks,
        ctr: safeDiv(agg.clicks, agg.impressions),
        cpmCents: Math.round(safeDiv(agg.spendCents * 1000, agg.impressions)),
        cpcCents: Math.round(safeDiv(agg.spendCents, agg.clicks)),
        conversionsCount: agg.conversionsCount,
        revenueCents: agg.revenueCents,
        roas: safeDiv(agg.revenueCents, agg.spendCents),
      };
    })
    .sort((a, b) => b.spendCents - a.spendCents)
    // Cap at 12 — prompt size + the report's actually-actionable set.
    .slice(0, 12);

  // Build roster summary — counts by status, plus the names of active
  // campaigns that didn't spend this window (the "needs attention" signal).
  const idsWithActivity = new Set(currentRows.map((r) => r.entityId));
  const activeCampaigns = allCampaigns.filter((c) => c.status === "ACTIVE");
  const pausedCampaigns = allCampaigns.filter((c) => c.status === "PAUSED");
  const activeWithoutActivityNames = activeCampaigns
    .filter((c) => !idsWithActivity.has(c.metaCampaignId))
    .map((c) => c.name);

  return {
    account: {
      name: account.name,
      businessName: account.business.name,
      currency: account.currency,
      timezone: account.timezone,
    },
    periods: {
      current: { from: isoDate(currentFrom), to: isoDate(currentTo) },
      previous: { from: isoDate(previousFrom), to: isoDate(previousTo) },
    },
    totals: {
      current: totalsFor(currentRows),
      previous: totalsFor(previousRows),
    },
    campaigns: campaignRows,
    roster: {
      totalCampaigns: allCampaigns.length,
      activeCampaigns: activeCampaigns.length,
      pausedCampaigns: pausedCampaigns.length,
      activeWithoutActivity: activeWithoutActivityNames.length,
      // Cap to keep prompt size sane on big accounts.
      activeWithoutActivitySample: activeWithoutActivityNames.slice(0, 15),
    },
    coverage: {
      daysWithData: daysSeen.size,
      lastSyncedAt: lastSync?.finishedAt?.toISOString() ?? null,
    },
  };
}
