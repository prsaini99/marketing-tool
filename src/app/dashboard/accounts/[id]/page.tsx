/**
 * Account detail page — the "see more" view from the accounts row menu.
 *
 * Lives at /dashboard/accounts/[id] (single segment, no /campaigns).
 *
 * Shows account-level state that doesn't fit cleanly on the campaigns
 * drill-down: metadata, lifetime KPIs over the selected window, connection
 * lineage, and recent sync history. Schedules + Disconnect intentionally
 * left for a follow-up.
 */

import Link from "next/link";
import {
  Building2,
  ChevronRight,
  CircleDot,
  Clock,
  Plug,
} from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils";
import { resolveDateRange } from "@/lib/date-range";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/insights/kpi-card";
import { SyncNowButton } from "@/components/sync/sync-now-button";

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

function formatDuration(start: Date, end: Date | null): string {
  if (!end) return "—";
  const ms = end.getTime() - start.getTime();
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1_000)}s`;
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

const SYNC_KIND_LABEL: Record<string, string> = {
  campaigns: "Campaigns",
  adsets: "Ad sets",
  ads: "Ads",
  insights: "Insights",
};

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
    include: {
      business: { include: { connection: true } },
    },
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

  const [accountTotals, campaignsCount, insightsSync, syncLogs] =
    await Promise.all([
      prisma.insightsSnapshot.aggregate({
        where: {
          adAccountId: account.id,
          level: "account",
          ...dateFilter,
        },
        _sum: { spendCents: true, impressions: true, clicks: true },
      }),
      prisma.campaign.count({
        where: { adAccountId: account.id },
      }),
      prisma.syncLog.findFirst({
        where: {
          adAccountId: account.id,
          kind: "insights",
          status: "success",
        },
        orderBy: { finishedAt: "desc" },
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
            {fullAccountId} · {account.currency} · {account.timezone}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <DateRangeDropdown />
          <SyncNowButton accountId={id} kinds={["insights"]} label="Sync insights" />
        </div>
      </div>

      {/* Meta strip */}
      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-subtle">Currency</dt>
          <dd className="mt-0.5 font-medium text-foreground">
            {account.currency}
          </dd>
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
            {campaignsCount}
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
            value={
              hasInsights ? formatMoney(spendCents / 100, account.currency) : "—"
            }
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

      {/* Connection lineage */}
      <section className="rounded-lg border border-border bg-background p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-surface-2">
            <Plug className="h-3.5 w-3.5 text-muted" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold tracking-tight">Connection</h3>
            <p className="mt-0.5 text-xs text-muted">
              Synced via{" "}
              <span className="text-foreground">
                {account.business.connection.label ||
                  account.business.connection.tokenOwnerName ||
                  "Untitled connection"}
              </span>{" "}
              · token owner{" "}
              <span className="text-foreground">
                {account.business.connection.tokenOwnerName ?? "—"}
              </span>{" "}
              · last discovered{" "}
              {formatRelative(account.business.connection.lastDiscoveredAt)}
            </p>
          </div>
          <Link
            href="/dashboard/settings"
            className="shrink-0 text-xs text-muted hover:text-foreground"
          >
            Manage in Settings →
          </Link>
        </div>
      </section>

      {/* Sync history */}
      <section>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted" />
          <h2 className="text-sm font-semibold tracking-tight">
            Recent sync history
          </h2>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          Latest 10 sync attempts for this account.
        </p>

        {syncLogs.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-subtle">
            No sync runs yet. Trigger a sync from this account&apos;s drill-down
            pages to populate.
          </p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-subtle">
                  <th className="px-4 py-2.5">Kind</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Started</th>
                  <th className="px-4 py-2.5">Duration</th>
                  <th className="px-4 py-2.5">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {syncLogs.map((l) => (
                  <tr key={l.id} className="hover:bg-surface transition-colors">
                    <td className="px-4 py-2.5 text-sm font-medium">
                      {SYNC_KIND_LABEL[l.kind] ?? l.kind}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                          l.status === "success"
                            ? "bg-green-50 text-green-700"
                            : l.status === "running"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-red-50 text-red-700",
                        )}
                      >
                        <CircleDot
                          className={cn(
                            "h-3 w-3",
                            l.status === "success"
                              ? "text-green-500"
                              : l.status === "running"
                                ? "text-blue-500"
                                : "text-red-500",
                          )}
                        />
                        {l.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {formatRelative(l.startedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-muted">
                      {formatDuration(l.startedAt, l.finishedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-subtle">
                      {l.error ? (
                        <span
                          className="line-clamp-1 text-danger"
                          title={l.error}
                        >
                          {l.error}
                        </span>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Footer link */}
      <div className="border-t border-border pt-4">
        <Link
          href={`/dashboard/accounts/${id}/campaigns`}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
        >
          View campaigns in this account
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
