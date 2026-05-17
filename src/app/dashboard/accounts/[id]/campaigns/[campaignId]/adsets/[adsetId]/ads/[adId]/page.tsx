/**
 * Ad detail page — the bottom of the drill-down hierarchy.
 *
 * Pattern matches the campaign / adset detail pages:
 *   1. Breadcrumb at top tracking the full path.
 *   2. Header block — ad name, status pill, last-edited timestamp,
 *      right-aligned actions (date range, preview, sync now).
 *   3. KPI strip — spend / impressions / clicks / CTR / CPM over the range.
 *   4. Asset section — creative card + image OR video card. Reuses the
 *      shared <CreativeCard /> / <ImageAssetCard /> / <VideoAssetCard />
 *      components from src/components/ads/ad-asset-cards.tsx.
 *
 * Notes:
 *  - All data comes from local DB tables (Ad / AdCreative / AdImage /
 *    AdVideo / InsightsSnapshot). Sync to refresh.
 *  - Page-uploaded videos arrive without length / source URL because
 *    Meta gates that behind Page-level app scopes (we don't have them).
 *    The VideoAssetCard renders a partial-mode tile in that case.
 */

import Link from "next/link";
import { ChevronRight, Megaphone } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils";
import { resolveDateRange } from "@/lib/date-range";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { KpiCard } from "@/components/insights/kpi-card";
import { EmptyState } from "@/components/ui/empty-state";
import { AdPreviewButton } from "@/components/ads/ad-preview-button";
import { SyncNowButton } from "@/components/sync/sync-now-button";
import { getAdFormatLabel } from "@/lib/display";
import {
  CreativeCard,
  ImageAssetCard,
  VideoAssetCard,
} from "@/components/ads/ad-asset-cards";

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

const STATUS_STYLE: Record<
  string,
  { pill: string; dot: string; label: string }
> = {
  ACTIVE: {
    pill: "bg-green-50 text-green-700",
    dot: "bg-green-500",
    label: "Active",
  },
  PAUSED: {
    pill: "bg-amber-50 text-amber-700",
    dot: "bg-amber-500",
    label: "Paused",
  },
  DELETED: {
    pill: "bg-red-50 text-red-700",
    dot: "bg-red-500",
    label: "Deleted",
  },
  ARCHIVED: {
    pill: "bg-zinc-100 text-zinc-600",
    dot: "bg-zinc-400",
    label: "Archived",
  },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? {
    pill: "bg-zinc-100 text-zinc-600",
    dot: "bg-zinc-400",
    label: status,
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        s.pill,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export default async function AdDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{
    id: string;
    campaignId: string;
    adsetId: string;
    adId: string;
  }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { id, campaignId, adsetId, adId } = await params;
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

  const [campaign, adSet, ad] = await Promise.all([
    prisma.campaign.findFirst({
      where: { adAccountId: account.id, metaCampaignId: campaignId },
    }),
    prisma.adSet.findFirst({
      where: { adAccountId: account.id, metaAdSetId: adsetId },
    }),
    prisma.ad.findFirst({
      where: { adAccountId: account.id, metaAdId: adId },
    }),
  ]);

  if (!ad) {
    return (
      <div className="space-y-4">
        <nav className="flex items-center gap-1 text-xs text-muted">
          <Link href="/dashboard/accounts" className="hover:text-foreground">
            Accounts
          </Link>
          <ChevronRight className="h-3 w-3 text-subtle" />
          <span className="text-foreground">Ad not found</span>
        </nav>
        <EmptyState
          icon={Megaphone}
          title="Ad not found locally"
          description="This ad isn't in our DB yet. Try Sync now on the parent ad set to pull it from Meta."
          action={{
            label: "Back to ad set",
            href: `/dashboard/accounts/${id}/campaigns/${campaignId}/adsets/${adsetId}/ads`,
          }}
        />
      </div>
    );
  }

  // Pull the creative + image + video for the asset section.
  const creative = ad.metaCreativeId
    ? await prisma.adCreative.findFirst({
        where: {
          adAccountId: account.id,
          metaCreativeId: ad.metaCreativeId,
        },
      })
    : null;
  const image = creative?.imageHash
    ? await prisma.adImage.findFirst({
        where: {
          adAccountId: account.id,
          metaImageHash: creative.imageHash,
        },
      })
    : null;
  const video = creative?.videoId
    ? await prisma.adVideo.findFirst({
        where: {
          adAccountId: account.id,
          metaVideoId: creative.videoId,
        },
      })
    : null;

  // Aggregate insights for this ad over the date range.
  const dateFilter = dateRange.since ? { date: { gte: dateRange.since } } : {};
  const totals = await prisma.insightsSnapshot.aggregate({
    where: {
      adAccountId: account.id,
      level: "ad",
      entityId: adId,
      ...dateFilter,
    },
    _sum: {
      spendCents: true,
      impressions: true,
      clicks: true,
      reach: true,
      cpmCents: true,
    },
    _count: { _all: true },
  });

  const insightsSync = await prisma.syncLog.findFirst({
    where: { adAccountId: account.id, kind: "insights", status: "success" },
    orderBy: { finishedAt: "desc" },
  });
  const hasInsights = Boolean(insightsSync);

  const spendCents = totals._sum.spendCents ?? 0;
  const impressions = totals._sum.impressions ?? 0;
  const clicks = totals._sum.clicks ?? 0;
  const reach = totals._sum.reach ?? 0;
  const ctr = impressions > 0 ? clicks / impressions : 0;
  // CPM stored per-day in InsightsSnapshot; average across days for the
  // headline. For most agency dashboards this is the number senior wants.
  const dayCount = totals._count._all || 1;
  const avgCpmCents = Math.round((totals._sum.cpmCents ?? 0) / dayCount);

  const currency = account.currency;

  return (
    <div className="space-y-5">
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
        <Link
          href={`/dashboard/accounts/${id}/campaigns/${campaignId}/adsets/${adsetId}/ads`}
          className="hover:text-foreground"
        >
          {adSet?.name ?? adsetId}
        </Link>
        <ChevronRight className="h-3 w-3 text-subtle" />
        <span className="text-foreground">{ad.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{ad.name}</h1>
            <StatusPill status={ad.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            <span className="text-foreground">{getAdFormatLabel(ad.format)}</span>{" "}
            · ID {ad.metaAdId} · Last edited{" "}
            {formatRelative(ad.metaUpdatedTime)}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <DateRangeDropdown />
          <AdPreviewButton metaAdId={ad.metaAdId} adName={ad.name} />
          {/* Same chain as the list page so a single sync from here refreshes
              everything needed to render this page accurately. */}
          <SyncNowButton
            accountId={id}
            kinds={["ads", "creatives", "images", "videos", "insights"]}
          />
        </div>
      </div>

      {/* KPIs */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Performance</h2>
          <p className="text-xs text-muted">{dateRange.label}</p>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <KpiCard
            label="Spend"
            value={hasInsights ? formatMoney(spendCents / 100, currency) : "—"}
          />
          <KpiCard
            label="Impressions"
            value={hasInsights ? formatCompact(impressions) : "—"}
          />
          <KpiCard
            label="Reach"
            value={hasInsights ? formatCompact(reach) : "—"}
          />
          <KpiCard
            label="Clicks"
            value={hasInsights ? formatCompact(clicks) : "—"}
          />
          <KpiCard
            label="CTR"
            value={hasInsights ? `${(ctr * 100).toFixed(2)}%` : "—"}
          />
        </div>
        {hasInsights && avgCpmCents > 0 && (
          <p className="mt-2 text-xs text-subtle">
            Avg CPM: {formatMoney(avgCpmCents / 100, currency)} · aggregated
            from {dayCount} daily snapshot{dayCount === 1 ? "" : "s"}.
          </p>
        )}
      </section>

      {/* Asset section */}
      <section>
        <h2 className="text-sm font-semibold tracking-tight">Ad assets</h2>
        <p className="mt-0.5 text-xs text-muted">
          The creative, image and video that make up what a viewer sees.
        </p>
        {!ad.metaCreativeId ? (
          <p className="mt-3 text-sm text-muted">
            No creative attached to this ad on Meta&apos;s side yet.
          </p>
        ) : !creative ? (
          <p className="mt-3 text-sm text-muted">
            Creative not synced yet — click Sync now above.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <CreativeCard
              name={creative.name}
              title={creative.title}
              body={creative.body}
              ctaType={creative.callToActionType}
              status={creative.status}
              thumbnailUrl={
                creative.thumbnailUrl ?? ad.creativeThumbnailUrl ?? null
              }
              metaCreativeId={creative.metaCreativeId}
            />
            {creative.imageHash && (
              <ImageAssetCard
                name={image?.name ?? null}
                hash={creative.imageHash}
                width={image?.width ?? null}
                height={image?.height ?? null}
                url={image?.url ?? null}
              />
            )}
            {creative.videoId && (
              <VideoAssetCard
                title={video?.title ?? null}
                videoId={creative.videoId}
                thumbnailUrl={
                  video?.thumbnailUrl ??
                  creative.thumbnailUrl ??
                  ad.creativeThumbnailUrl ??
                  null
                }
                sourceUrl={video?.sourceUrl ?? null}
                lengthSeconds={video?.lengthSeconds ?? null}
                partial={!video}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}
