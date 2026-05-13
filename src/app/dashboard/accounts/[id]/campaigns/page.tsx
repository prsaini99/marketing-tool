import Link from "next/link";
import { ChevronRight, Download, Megaphone } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { CampaignsTable } from "@/components/tables/campaigns-table";
import { SyncNowButton } from "@/components/sync/sync-now-button";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { resolveDateRange } from "@/lib/date-range";
import type { DisplayCampaign } from "@/lib/display";

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

export default async function CampaignsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { id } = await params;
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
        <nav className="flex items-center gap-1 text-xs text-muted">
          <Link href="/dashboard/accounts" className="hover:text-foreground">
            Accounts
          </Link>
          <ChevronRight className="h-3 w-3 text-subtle" />
          <span className="text-foreground">{fullAccountId}</span>
        </nav>
        <EmptyState
          icon={Megaphone}
          title="Ad account not found"
          description="This ad account isn't currently selected for sync — or has been removed since this page was bookmarked."
          action={{
            label: "Manage connections",
            href: "/dashboard/connect-business",
          }}
        />
      </div>
    );
  }

  const [campaigns, campaignsSync, insightsSync, perCampaign] =
    await Promise.all([
      prisma.campaign.findMany({
        where: { adAccountId: account.id },
        orderBy: { name: "asc" },
      }),
      prisma.syncLog.findFirst({
        where: {
          adAccountId: account.id,
          kind: "campaigns",
          status: "success",
        },
        orderBy: { finishedAt: "desc" },
      }),
      prisma.syncLog.findFirst({
        where: {
          adAccountId: account.id,
          kind: "insights",
          status: "success",
        },
        orderBy: { finishedAt: "desc" },
      }),
      prisma.insightsSnapshot.groupBy({
        by: ["entityId"],
        where: {
          adAccountId: account.id,
          level: "campaign",
          ...(dateRange.since ? { date: { gte: dateRange.since } } : {}),
        },
        _sum: { spendCents: true, impressions: true, clicks: true },
      }),
    ]);

  const metricsByCampaign = new Map(
    perCampaign.map((m) => [
      m.entityId,
      {
        spendCents: m._sum.spendCents ?? 0,
        impressions: m._sum.impressions ?? 0,
        clicks: m._sum.clicks ?? 0,
      },
    ]),
  );

  const currency = account.currency;
  const activeCount = campaigns.filter((c) => c.status === "ACTIVE").length;
  const pausedCount = campaigns.filter((c) => c.status === "PAUSED").length;
  const hasInsights = Boolean(insightsSync);

  const displayCampaigns: DisplayCampaign[] = campaigns.map((c) => {
    const m = metricsByCampaign.get(c.metaCampaignId);
    const impressions = m?.impressions ?? 0;
    const clicks = m?.clicks ?? 0;
    return {
      id: c.metaCampaignId,
      adAccountId: account.metaAdAccountId,
      businessId: account.businessId,
      businessName: account.business.name,
      adAccountName: account.name,
      currency,
      name: c.name,
      status: c.status,
      objective: c.objective ?? "",
      dailyBudgetCents: c.dailyBudgetCents,
      lifetimeBudgetCents: c.lifetimeBudgetCents,
      spend7d: hasInsights ? (m?.spendCents ?? 0) / 100 : null,
      impressions: hasInsights ? impressions : null,
      clicks: hasInsights ? clicks : null,
      ctr: hasInsights ? (impressions > 0 ? clicks / impressions : 0) : null,
      lastEdited: formatRelative(c.metaUpdatedTime) ?? "—",
    };
  });

  const latestSync =
    campaignsSync && insightsSync
      ? campaignsSync.finishedAt &&
        insightsSync.finishedAt &&
        campaignsSync.finishedAt > insightsSync.finishedAt
        ? campaignsSync
        : insightsSync
      : campaignsSync || insightsSync;

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-xs text-muted">
        <Link href="/dashboard/accounts" className="hover:text-foreground">
          Accounts
        </Link>
        <ChevronRight className="h-3 w-3 text-subtle" />
        <span className="text-foreground">{account.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-0.5 text-sm text-muted">
            <span className="text-foreground">{account.business.name}</span> ·{" "}
            {fullAccountId} · {currency} · {activeCount} active ·{" "}
            {pausedCount} paused
            {latestSync?.finishedAt && (
              <> · Last synced {formatRelative(latestSync.finishedAt)}</>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <DateRangeDropdown />
          {/* Plain <a> for native download behavior — no client-side router. */}
          <a
            href={`/api/accounts/${id}/export/campaigns.csv${
              range ? `?range=${range}` : ""
            }`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium hover:bg-surface-2 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export to CSV
          </a>
          <SyncNowButton accountId={id} kinds={["campaigns", "insights"]} />
        </div>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={
            campaignsSync
              ? "No campaigns in this ad account"
              : "No campaigns synced yet"
          }
          description={
            campaignsSync
              ? "This account has no campaigns. They'll appear here when created in Meta Ads Manager."
              : "Click Sync campaigns above to pull campaigns from Meta."
          }
        />
      ) : (
        <CampaignsTable
          campaigns={displayCampaigns}
          accountId={id}
          currency={currency}
        />
      )}

      <p className="text-xs text-subtle">
        Spend / impressions / CTR aggregate {dateRange.label.toLowerCase()} of
        insights snapshots. Auto-sync schedules live in the ad account&apos;s
        ⋯ menu on the Accounts page.
      </p>
    </div>
  );
}
