import { Building2 } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import { AccountsTable } from "@/components/tables/accounts-table";
import { SyncAllInsightsButton } from "@/components/sync/sync-all-insights-button";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { resolveDateRange } from "@/lib/date-range";
import type { DisplayAdAccount } from "@/lib/display";

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

export default async function AccountsPage({
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

  // Dedupe by metaAdAccountId — same Meta account can come via multiple
  // Connections.
  const rows = await prisma.metaAdAccount.findMany({
    where: {
      selectedForSync: true,
      ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
    },
    include: { business: { select: { id: true, name: true } } },
    distinct: ["metaAdAccountId"],
    orderBy: { name: "asc" },
  });

  const accountIds = rows.map((r) => r.id);

  // Roll up spend per account at level=account over the selected window,
  // count active campaigns, and find the most-recent successful sync per
  // account — all in parallel.
  const [spendAgg, activeCounts, lastSyncs] = await Promise.all([
    prisma.insightsSnapshot.groupBy({
      by: ["adAccountId"],
      where: {
        adAccountId: { in: accountIds },
        level: "account",
        ...(dateRange.since ? { date: { gte: dateRange.since } } : {}),
      },
      _sum: { spendCents: true },
    }),
    prisma.campaign.groupBy({
      by: ["adAccountId"],
      where: { adAccountId: { in: accountIds }, status: "ACTIVE" },
      _count: { _all: true },
    }),
    prisma.syncLog.findMany({
      where: { adAccountId: { in: accountIds }, status: "success" },
      orderBy: { finishedAt: "desc" },
      distinct: ["adAccountId"],
      select: { adAccountId: true, finishedAt: true },
    }),
  ]);

  const spendByAccount = new Map(
    spendAgg.map((r) => [r.adAccountId, r._sum.spendCents ?? 0]),
  );
  const activeByAccount = new Map(
    activeCounts.map((r) => [r.adAccountId, r._count._all]),
  );
  const lastSyncByAccount = new Map(
    lastSyncs.map((r) => [r.adAccountId, r.finishedAt]),
  );

  // Has an insights sync ever finished for this account? Used to distinguish
  // "—" (never synced) from "₹0" (synced, no spend last 7d).
  const insightsSyncedAccountIds = new Set(
    (
      await prisma.syncLog.findMany({
        where: {
          adAccountId: { in: accountIds },
          kind: "insights",
          status: "success",
        },
        distinct: ["adAccountId"],
        select: { adAccountId: true },
      })
    ).map((r) => r.adAccountId),
  );

  const accounts: DisplayAdAccount[] = rows.map((r) => {
    const hasInsightsSync = insightsSyncedAccountIds.has(r.id);
    const spendCents = spendByAccount.get(r.id) ?? 0;
    return {
      id: r.metaAdAccountId,
      businessId: r.businessId,
      businessName: r.business.name,
      name: r.name,
      currency: r.currency,
      // Convert cents → display units. Null = never synced; 0 = synced but no spend in range.
      spend7d: hasInsightsSync ? spendCents / 100 : null,
      activeCampaigns: activeByAccount.get(r.id) ?? 0,
      status: r.status as DisplayAdAccount["status"],
      lastSync: formatRelative(lastSyncByAccount.get(r.id)),
    };
  });

  const totalSelected = await prisma.metaAdAccount
    .findMany({
      where: { selectedForSync: true },
      distinct: ["metaAdAccountId"],
      select: { id: true },
    })
    .then((r) => r.length);

  if (totalSelected === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ad accounts</h1>
          <p className="mt-0.5 text-sm text-muted">
            Connect a Meta business to start managing ad accounts.
          </p>
        </div>
        <EmptyState
          icon={Building2}
          title="No ad accounts selected yet"
          description="Paste a Meta access token and pick which ad accounts to manage."
          action={{
            label: "Connect a Meta business",
            href: "/dashboard/connect-business",
          }}
        />
      </div>
    );
  }

  // For the bulk-sync button, use the unprefixed Meta ids (URL form).
  const unprefixedIds = rows.map((r) =>
    r.metaAdAccountId.replace("act_", ""),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ad accounts</h1>
          <p className="mt-0.5 text-sm text-muted">
            {selectedBusiness ? (
              <>
                {accounts.length}{" "}
                {accounts.length === 1 ? "account" : "accounts"} under{" "}
                <span className="text-foreground">{selectedBusiness.name}</span>
              </>
            ) : (
              <>
                {accounts.length}{" "}
                {accounts.length === 1 ? "account" : "accounts"} across all
                connected clients
              </>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <DateRangeDropdown />
          <SyncAllInsightsButton accountIds={unprefixedIds} />
        </div>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={`No ad accounts under ${selectedBusiness?.name ?? "this client"} yet`}
          description="Switch clients in the top bar, or select more ad accounts on the connect page."
          action={{
            label: "Manage selections",
            href: "/dashboard/connect-business",
          }}
        />
      ) : (
        <AccountsTable accounts={accounts} />
      )}

      <p className="text-xs text-subtle">
        Spend column shows {dateRange.label.toLowerCase()}. Click Sync all
        insights to refresh from Meta.
      </p>
    </div>
  );
}
