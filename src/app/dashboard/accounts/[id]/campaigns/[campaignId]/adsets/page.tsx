import Link from "next/link";
import { ChevronRight, Layers } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { AdSetsTable } from "@/components/tables/adsets-table";
import { SyncNowButton } from "@/components/sync/sync-now-button";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { resolveDateRange } from "@/lib/date-range";
import type { DisplayAdSet } from "@/lib/display";

function formatRelative(d: Date | null | undefined): string | null {
  if (!d) return null;
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

export default async function AdSetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; campaignId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { id, campaignId } = await params;
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
          icon={Layers}
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

  const campaign = await prisma.campaign.findFirst({
    where: { adAccountId: account.id, metaCampaignId: campaignId },
  });

  const [adSets, lastSync, insightsSync, perAdSet] = await Promise.all([
    campaign
      ? prisma.adSet.findMany({
          where: { campaignId: campaign.id },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    prisma.syncLog.findFirst({
      where: { adAccountId: account.id, kind: "adsets", status: "success" },
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
        level: "adset",
        ...(dateRange.since ? { date: { gte: dateRange.since } } : {}),
      },
      _sum: { spendCents: true, impressions: true, clicks: true },
    }),
  ]);

  const metricsByAdSet = new Map(
    perAdSet.map((m) => [
      m.entityId,
      {
        spendCents: m._sum.spendCents ?? 0,
        impressions: m._sum.impressions ?? 0,
        clicks: m._sum.clicks ?? 0,
      },
    ]),
  );

  const activeCount = adSets.filter((s) => s.status === "ACTIVE").length;
  const pausedCount = adSets.filter((s) => s.status === "PAUSED").length;
  const currency = account.currency;
  const hasInsights = Boolean(insightsSync);

  const displayAdSets: DisplayAdSet[] = adSets.map((s) => {
    const m = metricsByAdSet.get(s.metaAdSetId);
    return {
      id: s.metaAdSetId,
      name: s.name,
      status: s.status,
      optimizationGoal: s.optimizationGoal,
      dailyBudgetCents: s.dailyBudgetCents,
      lifetimeBudgetCents: s.lifetimeBudgetCents,
      spend7d: hasInsights ? (m?.spendCents ?? 0) / 100 : null,
      impressions: hasInsights ? (m?.impressions ?? 0) : null,
      // Results / cost-per-result require parsing Meta's `actions` field with
      // attribution windows — deferred for now.
      results: null,
      costPerResultCents: null,
      lastEdited: formatRelative(s.metaUpdatedTime) ?? "—",
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
        <span className="text-foreground">
          {campaign?.name ?? campaignId}
        </span>
      </nav>

      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ad sets</h1>
          <p className="mt-0.5 text-sm text-muted">
            {campaign ? (
              <>
                Campaign:{" "}
                <span className="text-foreground">{campaign.name}</span> ·{" "}
                {activeCount} active · {pausedCount} paused
              </>
            ) : (
              <>Campaign not found locally — try syncing campaigns first</>
            )}
            {lastSync?.finishedAt && (
              <> · Last synced {formatRelative(lastSync.finishedAt)}</>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <DateRangeDropdown />
          <SyncNowButton accountId={id} kinds={["adsets", "insights"]} />
        </div>
      </div>

      {adSets.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={
            lastSync ? "No ad sets in this campaign" : "No ad sets synced yet"
          }
          description={
            lastSync
              ? "This campaign has no ad sets. They'll appear once created in Meta."
              : "Click Sync ad sets above to pull from Meta."
          }
        />
      ) : (
        <AdSetsTable
          adSets={displayAdSets}
          accountId={id}
          campaignId={campaignId}
          currency={currency}
        />
      )}

      <p className="text-xs text-subtle">
        Spend column shows {dateRange.label.toLowerCase()}.
      </p>
    </div>
  );
}
