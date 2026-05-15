import { Megaphone } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import { FlatAdsTable } from "@/components/tables/flat-ads-table";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { SearchBar } from "@/components/ui/search-bar";
import { resolveDateRange } from "@/lib/date-range";
import type { FlatDisplayAd } from "@/lib/display";

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

export default async function AdsFlatPage({
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

  const [rows, perAd, anyInsightsSync] = await Promise.all([
    prisma.ad.findMany({
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
        adSet: {
          select: {
            metaAdSetId: true,
            name: true,
            campaign: { select: { metaCampaignId: true, name: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.insightsSnapshot.groupBy({
      by: ["adAccountId", "entityId"],
      where: {
        level: "ad",
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

  const key = (acctId: string, adId: string) => `${acctId}::${adId}`;
  const metricsByAd = new Map(
    perAd.map((m) => [
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

  const ads: FlatDisplayAd[] = rows.map((a) => {
    const m = metricsByAd.get(key(a.adAccount.id, a.metaAdId));
    const imps = m?.impressions ?? 0;
    const clks = m?.clicks ?? 0;
    return {
      id: a.metaAdId,
      adAccountId: a.adAccount.metaAdAccountId,
      businessId: a.adAccount.businessId,
      businessName: a.adAccount.business.name,
      adAccountName: a.adAccount.name,
      currency: a.adAccount.currency,
      adSetName: a.adSet.name,
      adSetId: a.adSet.metaAdSetId,
      campaignName: a.adSet.campaign.name,
      campaignId: a.adSet.campaign.metaCampaignId,
      name: a.name,
      status: a.status,
      format: a.format,
      spend: hasInsights ? (m?.spendCents ?? 0) / 100 : null,
      impressions: hasInsights ? imps : null,
      ctr: hasInsights ? (imps > 0 ? clks / imps : 0) : null,
      lastEdited: formatRelative(a.metaUpdatedTime),
    };
  });

  const totalAcrossAll = await prisma.ad.count({
    where: { adAccount: { selectedForSync: true } },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ads</h1>
          <p className="mt-0.5 text-sm text-muted">
            {selectedBusiness ? (
              <>
                {ads.length} ads under{" "}
                <span className="text-foreground">{selectedBusiness.name}</span>{" "}
                · {activeCount} active · {pausedCount} paused
              </>
            ) : (
              <>
                {ads.length} ads across all connected clients ·{" "}
                {activeCount} active · {pausedCount} paused
              </>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <SearchBar placeholder="Search ads…" />
          <DateRangeDropdown />
        </div>
      </div>

      {totalAcrossAll === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No ads synced yet"
          description="Drill into an ad account and click Sync now to pull ads from Meta."
          action={{
            label: "Go to accounts",
            href: "/dashboard/accounts",
          }}
        />
      ) : ads.length === 0 && query ? (
        <EmptyState
          icon={Megaphone}
          title={`No ads match “${query}”`}
          description="Try a shorter query, or clear the search to see all ads."
        />
      ) : ads.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={`No ads under ${selectedBusiness?.name ?? "this client"}`}
          description="Switch clients in the top bar, or sync this client's ad accounts."
        />
      ) : (
        <FlatAdsTable ads={ads} />
      )}

      <p className="text-xs text-subtle">
        Spend / impressions / CTR aggregate {dateRange.label.toLowerCase()} of
        insights snapshots.
      </p>
    </div>
  );
}
