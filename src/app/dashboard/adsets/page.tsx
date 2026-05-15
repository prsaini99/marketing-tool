import { Layers } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import { FlatAdSetsTable } from "@/components/tables/flat-adsets-table";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { SearchBar } from "@/components/ui/search-bar";
import { resolveDateRange } from "@/lib/date-range";
import type { FlatDisplayAdSet } from "@/lib/display";

function formatRelative(d: Date | null): string {
  if (!d) return "—";
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)} days ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(d);
}

export default async function AdSetsFlatPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; range?: string; q?: string }>;
}) {
  const { client, range, q } = await searchParams;
  const dateRange = resolveDateRange(range);
  const query = q?.trim();
  const selectedBusiness = client
    ? await prisma.metaBusiness.findUnique({
        where: { id: client },
        select: { id: true, name: true },
      })
    : null;

  const dateFilter = dateRange.since ? { date: { gte: dateRange.since } } : {};

  const [rows, perAdSet, anyInsightsSync] = await Promise.all([
    prisma.adSet.findMany({
      where: {
        adAccount: {
          selectedForSync: true,
          ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
        },
        ...(query
          ? { name: { contains: query, mode: "insensitive" } }
          : {}),
      },
      include: {
        adAccount: {
          select: {
            id: true,
            metaAdAccountId: true,
            name: true,
            currency: true,
            businessId: true,
            business: { select: { name: true } },
          },
        },
        campaign: {
          select: { metaCampaignId: true, name: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.insightsSnapshot.groupBy({
      by: ["adAccountId", "entityId"],
      where: {
        level: "adset",
        adAccount: {
          selectedForSync: true,
          ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
        },
        ...dateFilter,
      },
      _sum: { spendCents: true, impressions: true, clicks: true },
    }),
    prisma.syncLog.findFirst({
      where: {
        kind: "insights",
        status: "success",
        adAccount: {
          selectedForSync: true,
          ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
        },
      },
      select: { id: true },
    }),
  ]);

  // Key by (adAccountInternalId, metaAdSetId) so the same ad set id across
  // different accounts is bucketed independently.
  const key = (acctId: string, adSetId: string) => `${acctId}::${adSetId}`;
  const metricsByAdSet = new Map(
    perAdSet.map((m) => [
      key(m.adAccountId, m.entityId),
      {
        spendCents: m._sum.spendCents ?? 0,
        impressions: m._sum.impressions ?? 0,
        clicks: m._sum.clicks ?? 0,
      },
    ]),
  );

  const hasInsights = Boolean(anyInsightsSync);
  const activeCount = rows.filter((r) => r.status === "ACTIVE").length;
  const pausedCount = rows.filter((r) => r.status === "PAUSED").length;

  const adSets: FlatDisplayAdSet[] = rows.map((s) => {
    const m = metricsByAdSet.get(key(s.adAccount.id, s.metaAdSetId));
    const imps = m?.impressions ?? 0;
    const clks = m?.clicks ?? 0;
    return {
      id: s.metaAdSetId,
      adAccountId: s.adAccount.metaAdAccountId,
      businessId: s.adAccount.businessId,
      businessName: s.adAccount.business.name,
      adAccountName: s.adAccount.name,
      currency: s.adAccount.currency,
      campaignName: s.campaign.name,
      campaignId: s.campaign.metaCampaignId,
      name: s.name,
      status: s.status,
      optimizationGoal: s.optimizationGoal,
      dailyBudgetCents: s.dailyBudgetCents,
      lifetimeBudgetCents: s.lifetimeBudgetCents,
      spend: hasInsights ? (m?.spendCents ?? 0) / 100 : null,
      impressions: hasInsights ? imps : null,
      ctr: hasInsights ? (imps > 0 ? clks / imps : 0) : null,
      lastEdited: formatRelative(s.metaUpdatedTime),
    };
  });

  const totalAcrossAll = await prisma.adSet.count({
    where: { adAccount: { selectedForSync: true } },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ad sets</h1>
          <p className="mt-0.5 text-sm text-muted">
            {selectedBusiness ? (
              <>
                {adSets.length} ad sets under{" "}
                <span className="text-foreground">{selectedBusiness.name}</span>{" "}
                · {activeCount} active · {pausedCount} paused
              </>
            ) : (
              <>
                {adSets.length} ad sets across all connected clients ·{" "}
                {activeCount} active · {pausedCount} paused
              </>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <SearchBar placeholder="Search ad sets…" />
          <DateRangeDropdown />
        </div>
      </div>

      {totalAcrossAll === 0 ? (
        <EmptyState
          icon={Layers}
          title="No ad sets synced yet"
          description="Drill into an ad account and click Sync now to pull ad sets from Meta."
          action={{
            label: "Go to accounts",
            href: "/dashboard/accounts",
          }}
        />
      ) : adSets.length === 0 && query ? (
        <EmptyState
          icon={Layers}
          title={`No ad sets match “${query}”`}
          description="Try a shorter query, or clear the search to see all ad sets."
        />
      ) : adSets.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={`No ad sets under ${selectedBusiness?.name ?? "this client"}`}
          description="Switch clients in the top bar, or sync this client's ad accounts."
        />
      ) : (
        <FlatAdSetsTable adSets={adSets} />
      )}

      <p className="text-xs text-subtle">
        Spend / impressions / CTR aggregate {dateRange.label.toLowerCase()} of
        insights snapshots.
      </p>
    </div>
  );
}
