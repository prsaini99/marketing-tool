/**
 * Account detail page — the merged "details + campaigns" view.
 *
 * Lives at /dashboard/accounts/[id] and is the default destination when
 * clicking a row on /dashboard/accounts. Combines:
 *   • Compact header (name, status, breadcrumb)
 *   • Stat strip (currency, timezone, campaigns synced, selected)
 *   • Performance KPIs over the selected window
 *   • Campaigns table with bulk ops (same component used elsewhere)
 *
 * Sync history is one click away via the Sync history button (modal).
 * Connection lineage was moved to Settings — no need to repeat here.
 */

import Link from "next/link";
import { Building2, ChevronRight, Megaphone } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils";
import { resolveDateRange } from "@/lib/date-range";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/insights/kpi-card";
import { SyncNowButton } from "@/components/sync/sync-now-button";
import { SyncHistoryButton } from "@/components/sync/sync-history-button";
import { SchedulesButton } from "@/components/schedules/schedules-button";
import { NewCampaignButton } from "@/components/campaigns/new-campaign-button";
import { CampaignsTable } from "@/components/tables/campaigns-table";
import type { DisplayCampaign } from "@/lib/display";

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

const STATUS_STYLE: Record<
  string,
  { pill: string; dot: string; label: string }
> = {
  ACTIVE: { pill: "bg-green-50 text-green-700", dot: "bg-green-500", label: "Active" },
  DISABLED: { pill: "bg-zinc-100 text-zinc-600", dot: "bg-zinc-400", label: "Disabled" },
  UNSETTLED: { pill: "bg-amber-50 text-amber-700", dot: "bg-amber-500", label: "Unsettled" },
  PENDING_REVIEW: { pill: "bg-blue-50 text-blue-700", dot: "bg-blue-500", label: "Pending review" },
  CLOSED: { pill: "bg-zinc-100 text-zinc-600", dot: "bg-zinc-400", label: "Closed" },
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

export default async function AccountDetailPage({
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
          icon={Building2}
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

  const dateFilter = dateRange.since ? { date: { gte: dateRange.since } } : {};

  const [
    accountTotals,
    campaigns,
    campaignsSync,
    insightsSync,
    perCampaign,
    syncLogs,
  ] = await Promise.all([
    prisma.insightsSnapshot.aggregate({
      where: { adAccountId: account.id, level: "account", ...dateFilter },
      _sum: { spendCents: true, impressions: true, clicks: true },
    }),
    prisma.campaign.findMany({
      where: { adAccountId: account.id },
      orderBy: { name: "asc" },
    }),
    prisma.syncLog.findFirst({
      where: { adAccountId: account.id, kind: "campaigns", status: "success" },
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
        level: "campaign",
        ...(dateRange.since ? { date: { gte: dateRange.since } } : {}),
      },
      _sum: { spendCents: true, impressions: true, clicks: true },
    }),
    prisma.syncLog.findMany({
      where: { adAccountId: account.id },
      orderBy: { startedAt: "desc" },
      take: 10,
    }),
  ]);

  const hasInsights = Boolean(insightsSync);
  const spendCents = accountTotals._sum.spendCents ?? 0;
  const impressions = accountTotals._sum.impressions ?? 0;
  const clicks = accountTotals._sum.clicks ?? 0;
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const currency = account.currency;

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

  const activeCount = campaigns.filter((c) => c.status === "ACTIVE").length;
  const pausedCount = campaigns.filter((c) => c.status === "PAUSED").length;

  const displayCampaigns: DisplayCampaign[] = campaigns.map((c) => {
    const m = metricsByCampaign.get(c.metaCampaignId);
    const imps = m?.impressions ?? 0;
    const clks = m?.clicks ?? 0;
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
      impressions: hasInsights ? imps : null,
      clicks: hasInsights ? clks : null,
      ctr: hasInsights ? (imps > 0 ? clks / imps : 0) : null,
      lastEdited: formatRelative(c.metaUpdatedTime) ?? "—",
    };
  });

  // SyncLog dates → ISO strings for the client component (Date objects don't
  // round-trip through the server/client boundary cleanly).
  const logsForClient = syncLogs.map((l) => ({
    id: l.id,
    kind: l.kind,
    status: l.status,
    error: l.error,
    startedAt: l.startedAt.toISOString(),
    finishedAt: l.finishedAt ? l.finishedAt.toISOString() : null,
  }));

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-xs text-muted">
        <Link href="/dashboard/accounts" className="hover:text-foreground">
          Accounts
        </Link>
        <ChevronRight className="h-3 w-3 text-subtle" />
        <span className="text-foreground">{account.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">
              {account.name}
            </h1>
            <StatusPill status={account.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            <span className="text-foreground">{account.business.name}</span> ·{" "}
            {fullAccountId} · {currency} · {account.timezone} · {activeCount}{" "}
            active · {pausedCount} paused
          </p>
        </div>
        <div className="flex items-start gap-2">
          <DateRangeDropdown />
          <SchedulesButton accountIdUrl={id} accountName={account.name} />
          <SyncHistoryButton logs={logsForClient} />
          <SyncNowButton accountId={id} kinds={["campaigns", "insights"]} />
          <NewCampaignButton
            accounts={[
              {
                metaAdAccountId: account.metaAdAccountId,
                name: account.name,
                currency: account.currency,
                businessName: account.business.name,
              },
            ]}
            lockedAdAccountId={account.metaAdAccountId}
          />
        </div>
      </div>

      {/* Stat strip */}
      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-subtle">Currency</dt>
          <dd className="mt-0.5 font-medium text-foreground">{currency}</dd>
        </div>
        <div>
          <dt className="text-subtle">Timezone</dt>
          <dd className="mt-0.5 font-medium text-foreground">
            {account.timezone}
          </dd>
        </div>
        <div>
          <dt className="text-subtle">Campaigns synced</dt>
          <dd className="mt-0.5 font-medium text-foreground">
            {campaigns.length}
          </dd>
        </div>
        <div>
          <dt className="text-subtle">Selected for sync</dt>
          <dd className="mt-0.5 font-medium text-foreground">
            {account.selectedForSync ? "Yes" : "No"}
          </dd>
        </div>
      </dl>

      {/* KPIs */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Performance</h2>
          <p className="text-xs text-muted">{dateRange.label}</p>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Spend"
            value={hasInsights ? formatMoney(spendCents / 100, currency) : "—"}
          />
          <KpiCard
            label="Impressions"
            value={hasInsights ? formatCompact(impressions) : "—"}
          />
          <KpiCard
            label="Clicks"
            value={hasInsights ? formatCompact(clicks) : "—"}
          />
          <KpiCard
            label="Avg CTR"
            value={hasInsights ? `${(ctr * 100).toFixed(2)}%` : "—"}
          />
        </div>
      </section>

      {/* Campaigns */}
      <section>
        <h2 className="text-sm font-semibold tracking-tight">Campaigns</h2>
        <div className="mt-2">
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
                  : "Click Sync now above to pull campaigns from Meta."
              }
            />
          ) : (
            <CampaignsTable
              campaigns={displayCampaigns}
              accountId={id}
              currency={currency}
            />
          )}
        </div>
        <p className="mt-3 text-xs text-subtle">
          Spend / impressions / CTR aggregate {dateRange.label.toLowerCase()} of
          insights snapshots.
        </p>
      </section>
    </div>
  );
}
