import Link from "next/link";
import { ChevronRight, Megaphone } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { SyncNowButton } from "@/components/sync/sync-now-button";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { NewAdButton } from "@/components/ads/new-ad-button";
import {
  PerAdsetAdsTable,
  type AdRow,
} from "@/components/tables/per-adset-ads-table";
import { resolveDateRange } from "@/lib/date-range";

function formatRelative(d: Date | null | undefined): string {
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

export default async function AdsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; campaignId: string; adsetId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { id, campaignId, adsetId } = await params;
  const { range } = await searchParams;
  const dateRange = resolveDateRange(range);
  const fullAccountId = `act_${id}`;

  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId: fullAccountId, selectedForSync: true },
    include: { business: true },
  });
  if (!account) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={Megaphone}
          title="Ad account not found"
          description="This ad account isn't currently selected for sync."
          action={{
            label: "Manage connections",
            href: "/dashboard/connect-business",
          }}
        />
      </div>
    );
  }

  const [campaign, adSet] = await Promise.all([
    prisma.campaign.findFirst({
      where: { adAccountId: account.id, metaCampaignId: campaignId },
    }),
    prisma.adSet.findFirst({
      where: { adAccountId: account.id, metaAdSetId: adsetId },
    }),
  ]);

  const [ads, lastSync, insightsSync, perAd] = await Promise.all([
    adSet
      ? prisma.ad.findMany({
          where: { adSetId: adSet.id },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    prisma.syncLog.findFirst({
      where: { adAccountId: account.id, kind: "ads", status: "success" },
      orderBy: { finishedAt: "desc" },
    }),
    prisma.syncLog.findFirst({
      where: { adAccountId: account.id, kind: "insights", status: "success" },
      orderBy: { finishedAt: "desc" },
    }),
    prisma.insightsSnapshot.groupBy({
      by: ["entityId"],
      where: {
        adAccountId: account.id,
        level: "ad",
        ...(dateRange.since ? { date: { gte: dateRange.since } } : {}),
      },
      _sum: { spendCents: true, impressions: true, clicks: true },
    }),
  ]);

  const metricsByAd = new Map(
    perAd.map((m) => [
      m.entityId,
      {
        spendCents: m._sum.spendCents ?? 0,
        impressions: m._sum.impressions ?? 0,
        clicks: m._sum.clicks ?? 0,
      },
    ]),
  );

  const activeCount = ads.filter((a) => a.status === "ACTIVE").length;
  const pausedCount = ads.filter((a) => a.status === "PAUSED").length;
  const currency = account.currency;
  const hasInsights = Boolean(insightsSync);

  const rows: AdRow[] = ads.map((a) => {
    const m = metricsByAd.get(a.metaAdId);
    return {
      id: a.id,
      metaAdId: a.metaAdId,
      name: a.name,
      status: a.status,
      format: a.format,
      creativeThumbnailUrl: a.creativeThumbnailUrl,
      metaUpdatedTime: a.metaUpdatedTime,
      spendCents: m?.spendCents ?? 0,
      impressions: m?.impressions ?? 0,
      clicks: m?.clicks ?? 0,
    };
  });

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-xs text-muted">
        <Link href="/dashboard/accounts" className="hover:text-foreground">
          Accounts
        </Link>
        <ChevronRight className="h-3 w-3 text-subtle" />
        <Link
          href={`/dashboard/accounts/${id}/campaigns`}
          className="hover:text-foreground"
        >
          {account.name}
        </Link>
        <ChevronRight className="h-3 w-3 text-subtle" />
        <Link
          href={`/dashboard/accounts/${id}/campaigns/${campaignId}/adsets`}
          className="hover:text-foreground"
        >
          {campaign?.name ?? campaignId}
        </Link>
        <ChevronRight className="h-3 w-3 text-subtle" />
        <span className="text-foreground">{adSet?.name ?? adsetId}</span>
      </nav>

      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ads</h1>
          <p className="mt-0.5 text-sm text-muted">
            {adSet ? (
              <>
                Ad set: <span className="text-foreground">{adSet.name}</span> ·{" "}
                {activeCount} active · {pausedCount} paused
              </>
            ) : (
              <>Ad set not found locally — try syncing ad sets first</>
            )}
            {lastSync?.finishedAt && (
              <> · Last synced {formatRelative(lastSync.finishedAt)}</>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <DateRangeDropdown />
          {/* The detail page reads creative + image + video joins from
              local DB; this sync chain keeps all four tables fresh so a
              click into any ad shows accurate asset info. */}
          <SyncNowButton
            accountId={id}
            kinds={["ads", "creatives", "images", "videos", "insights"]}
          />
          {adSet && (
            <NewAdButton
              adSet={{
                metaAdSetId: adSet.metaAdSetId,
                name: adSet.name,
              }}
            />
          )}
        </div>
      </div>

      {ads.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={lastSync ? "No ads in this ad set" : "No ads synced yet"}
          description={
            lastSync
              ? "This ad set has no ads. They'll appear once created in Meta."
              : "Click Sync now above to pull from Meta."
          }
        />
      ) : (
        <PerAdsetAdsTable
          rows={rows}
          currency={currency}
          hasInsights={hasInsights}
          accountIdUrl={id}
          campaignId={campaignId}
          adsetId={adsetId}
          rangeQuery={range ?? null}
        />
      )}

      <p className="text-xs text-subtle">
        Click any row to open the ad&apos;s detail — creative, image, video and
        per-ad insights. Per-ad metrics aggregate {dateRange.label.toLowerCase()}.
      </p>
    </div>
  );
}
