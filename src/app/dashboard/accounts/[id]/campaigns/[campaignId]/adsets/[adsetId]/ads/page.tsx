import Link from "next/link";
import {
  ChevronRight,
  Image as ImageIcon,
  LayoutGrid,
  Layers,
  Megaphone,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { prisma } from "@/lib/db/prisma";
import { getAdFormatLabel } from "@/lib/display";
import { SyncNowButton } from "@/components/sync/sync-now-button";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { AdPreviewButton } from "@/components/ads/ad-preview-button";
import { resolveDateRange } from "@/lib/date-range";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
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

function formatIcon(format: string | null) {
  switch (format) {
    case "VIDEO":
      return Video;
    case "CAROUSEL":
      return LayoutGrid;
    case "COLLECTION":
      return Layers;
    default:
      return ImageIcon;
  }
}

function statusStyle(status: string) {
  switch (status) {
    case "ACTIVE":
      return { pill: "bg-green-50 text-green-700", dot: "bg-green-500", label: "Active" };
    case "PAUSED":
      return { pill: "bg-amber-50 text-amber-700", dot: "bg-amber-500", label: "Paused" };
    case "DELETED":
      return { pill: "bg-red-50 text-red-700", dot: "bg-red-500", label: "Deleted" };
    case "ARCHIVED":
      return { pill: "bg-zinc-100 text-zinc-600", dot: "bg-zinc-400", label: "Archived" };
    default: {
      const label = status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
      return { pill: "bg-zinc-100 text-zinc-600", dot: "bg-zinc-400", label };
    }
  }
}

function StatusPill({ status }: { status: string }) {
  const s = statusStyle(status);
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
          <SyncNowButton accountId={id} kinds={["ads", "insights"]} />
        </div>
      </div>

      {ads.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={lastSync ? "No ads in this ad set" : "No ads synced yet"}
          description={
            lastSync
              ? "This ad set has no ads. They'll appear once created in Meta."
              : "Click Sync ads above to pull from Meta."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-subtle">
                <th className="px-4 py-2.5">Ad</th>
                <th className="px-4 py-2.5">Format</th>
                <th className="px-4 py-2.5 text-right">Spend</th>
                <th className="px-4 py-2.5 text-right">Impressions</th>
                <th className="px-4 py-2.5 text-right">Clicks</th>
                <th className="px-4 py-2.5 text-right">CTR</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Last edited</th>
                <th className="w-12 px-4 py-2.5 text-right">Preview</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ads.map((a) => {
                const Icon = formatIcon(a.format);
                const m = metricsByAd.get(a.metaAdId);
                const impressions = m?.impressions ?? 0;
                const clicks = m?.clicks ?? 0;
                const spendCents = m?.spendCents ?? 0;
                const ctr = impressions > 0 ? clicks / impressions : 0;
                return (
                  <tr
                    key={a.id}
                    className="hover:bg-surface transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-surface-2 ring-1 ring-border">
                          <Icon className="h-4 w-4 text-subtle" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{a.name}</span>
                          <span className="text-xs text-subtle">
                            {a.metaAdId}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {getAdFormatLabel(a.format)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium tabular-nums">
                      {hasInsights ? (
                        formatMoney(spendCents / 100, currency)
                      ) : (
                        <span className="font-normal text-subtle">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums">
                      {hasInsights ? (
                        impressions.toLocaleString()
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums">
                      {hasInsights ? (
                        clicks.toLocaleString()
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums">
                      {hasInsights ? (
                        `${(ctr * 100).toFixed(2)}%`
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={a.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {formatRelative(a.metaUpdatedTime)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <AdPreviewButton metaAdId={a.metaAdId} adName={a.name} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-subtle">
        Per-ad metrics aggregate {dateRange.label.toLowerCase()}.
      </p>
    </div>
  );
}
