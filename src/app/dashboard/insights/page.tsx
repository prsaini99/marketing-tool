import { BarChart3 } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { KpiCard } from "@/components/insights/kpi-card";
import { SpendChart } from "@/components/insights/spend-chart";
import { ClientSpendBar } from "@/components/insights/client-spend-bar";
import { TopCampaigns } from "@/components/insights/top-campaigns";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { SyncAllInsightsButton } from "@/components/sync/sync-all-insights-button";
import { resolveDateRange } from "@/lib/date-range";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCompact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; range?: string }>;
}) {
  const { client, range } = await searchParams;
  const dateRange = resolveDateRange(range);
  const selectedBusiness = client
    ? await prisma.metaBusiness.findUnique({
        where: { id: client },
        select: { id: true, name: true },
      })
    : null;

  const accounts = await prisma.metaAdAccount.findMany({
    where: {
      selectedForSync: true,
      ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
    },
    select: {
      id: true,
      metaAdAccountId: true,
      currency: true,
      business: { select: { id: true, name: true } },
    },
    distinct: ["metaAdAccountId"],
  });

  // For the bulk-sync button.
  const unprefixedIds = accounts.map((a) =>
    a.metaAdAccountId.replace("act_", ""),
  );
  const accountIds = accounts.map((a) => a.id);

  if (accountIds.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Insights</h1>
          <p className="mt-0.5 text-sm text-muted">
            {selectedBusiness ? (
              <>
                Performance overview for{" "}
                <span className="text-foreground">{selectedBusiness.name}</span>
              </>
            ) : (
              <>Cross-account performance overview.</>
            )}
          </p>
        </div>
        <EmptyState
          icon={BarChart3}
          title="No ad accounts selected"
          description="Select ad accounts on the connect page first, then sync insights here."
          action={{
            label: "Manage selections",
            href: "/dashboard/connect-business",
          }}
        />
      </div>
    );
  }

  // Currency: use the first account's currency. If accounts have mixed
  // currencies, the aggregate numbers are technically misleading; for Phase 1.2
  // we accept the simplification (most agencies operate one currency at a time).
  const currency = accounts[0].currency;

  const dateFilter = dateRange.since ? { date: { gte: dateRange.since } } : {};

  // Daily breakdown across all selected accounts (level=account).
  const [dailyRows, perAccount, perCampaign, insightsSyncCount] =
    await Promise.all([
      prisma.insightsSnapshot.groupBy({
        by: ["date"],
        where: {
          adAccountId: { in: accountIds },
          level: "account",
          ...dateFilter,
        },
        _sum: { spendCents: true, impressions: true, clicks: true },
        orderBy: { date: "asc" },
      }),
      prisma.insightsSnapshot.groupBy({
        by: ["adAccountId"],
        where: {
          adAccountId: { in: accountIds },
          level: "account",
          ...dateFilter,
        },
        _sum: { spendCents: true },
      }),
      prisma.insightsSnapshot.groupBy({
        by: ["entityId", "adAccountId"],
        where: {
          adAccountId: { in: accountIds },
          level: "campaign",
          ...dateFilter,
        },
        _sum: { spendCents: true },
        orderBy: { _sum: { spendCents: "desc" } },
        take: 5,
      }),
      prisma.syncLog.count({
        where: {
          adAccountId: { in: accountIds },
          kind: "insights",
          status: "success",
        },
      }),
    ]);

  const totalSpendCents = dailyRows.reduce(
    (n, r) => n + (r._sum.spendCents ?? 0),
    0,
  );
  const totalImpressions = dailyRows.reduce(
    (n, r) => n + (r._sum.impressions ?? 0),
    0,
  );
  const totalClicks = dailyRows.reduce(
    (n, r) => n + (r._sum.clicks ?? 0),
    0,
  );
  const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

  const dailyMetrics = dailyRows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    spend: (r._sum.spendCents ?? 0) / 100,
    impressions: r._sum.impressions ?? 0,
    clicks: r._sum.clicks ?? 0,
  }));

  // Roll per-account totals up into per-business buckets for "Spend by client".
  const businessByAccount = new Map(
    accounts.map((a) => [a.id, a.business]),
  );
  const spendByBusiness = new Map<string, { name: string; spend: number }>();
  for (const row of perAccount) {
    const biz = businessByAccount.get(row.adAccountId);
    if (!biz) continue;
    const cents = row._sum.spendCents ?? 0;
    const current = spendByBusiness.get(biz.id) ?? { name: biz.name, spend: 0 };
    current.spend += cents / 100;
    spendByBusiness.set(biz.id, current);
  }
  const totalSpend = totalSpendCents / 100;
  const clientSpendItems = Array.from(spendByBusiness.entries())
    .map(([id, v]) => ({
      businessId: id,
      name: v.name,
      spend: v.spend,
      share: totalSpend > 0 ? v.spend / totalSpend : 0,
    }))
    .sort((a, b) => b.spend - a.spend);

  // Top 5 campaigns: enrich with their Campaign rows for names + business.
  const topMetaIds = perCampaign.map((r) => r.entityId);
  const topMetaAccountIds = perCampaign.map((r) => r.adAccountId);
  const topCampaignsMeta = topMetaIds.length
    ? await prisma.campaign.findMany({
        where: {
          metaCampaignId: { in: topMetaIds },
          adAccountId: { in: topMetaAccountIds },
        },
        include: { adAccount: { include: { business: true } } },
      })
    : [];
  const metaToCampaign = new Map(
    topCampaignsMeta.map((c) => [`${c.adAccountId}:${c.metaCampaignId}`, c]),
  );
  const topCampaignsItems = perCampaign.map((r) => {
    const c = metaToCampaign.get(`${r.adAccountId}:${r.entityId}`);
    return {
      id: r.entityId,
      adAccountIdUrl: (c?.adAccount.metaAdAccountId ?? "").replace("act_", ""),
      businessId: c?.adAccount.business.id ?? "",
      name: c?.name ?? r.entityId,
      businessName: c?.adAccount.business.name ?? "",
      spend: (r._sum.spendCents ?? 0) / 100,
    };
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Insights</h1>
          <p className="mt-0.5 text-sm text-muted">
            {selectedBusiness ? (
              <>
                Performance overview for{" "}
                <span className="text-foreground">{selectedBusiness.name}</span>{" "}
                · {dateRange.label.toLowerCase()}
              </>
            ) : (
              <>
                Cross-account performance overview ·{" "}
                {dateRange.label.toLowerCase()}
              </>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <DateRangeDropdown />
          <SyncAllInsightsButton accountIds={unprefixedIds} />
        </div>
      </div>

      {insightsSyncCount === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No insights synced yet"
          description="Click Sync all insights above to pull spend, impressions and CTR from Meta for the last 7 days."
        />
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Total spend"
              value={formatMoney(totalSpend, currency)}
            />
            <KpiCard
              label="Impressions"
              value={formatCompact(totalImpressions)}
            />
            <KpiCard label="Clicks" value={formatCompact(totalClicks)} />
            <KpiCard
              label="Avg CTR"
              value={`${(avgCtr * 100).toFixed(2)}%`}
            />
          </div>

          {/* Chart */}
          <SpendChart
            metrics={dailyMetrics}
            currency={currency}
            rangeLabel={dateRange.label}
          />

          {/* Breakdowns */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ClientSpendBar
              items={clientSpendItems}
              currency={currency}
              rangeLabel={dateRange.label}
            />
            <TopCampaigns
              items={topCampaignsItems}
              currency={currency}
              rangeLabel={dateRange.label}
              range={range}
            />
          </div>
        </>
      )}

      <p className="text-xs text-subtle">
        Aggregated from local insights snapshots. Period-vs-prior comparison
        ships with Phase 1.3 (scheduled syncs).
      </p>
    </div>
  );
}
