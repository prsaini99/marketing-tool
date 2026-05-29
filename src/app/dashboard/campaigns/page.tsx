import { Download, Megaphone } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import { FlatCampaignsTable } from "@/components/tables/flat-campaigns-table";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { NewCampaignButton } from "@/components/campaigns/new-campaign-button";
import { SearchBar } from "@/components/ui/search-bar";
import { BulkSyncButton } from "@/components/sync/bulk-sync-button";
import { resolveDateRange } from "@/lib/date-range";
import type { DisplayCampaign } from "@/lib/display";

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

export default async function CampaignsFlatPage({
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

  const [rows, perCampaign, anyInsightsSync, accountsForCreate] =
    await Promise.all([
      prisma.campaign.findMany({
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
        },
        orderBy: { name: "asc" },
      }),
      prisma.insightsSnapshot.groupBy({
        by: ["adAccountId", "entityId"],
        where: {
          level: "campaign",
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
      // Account list for the New campaign picker — every selected account,
      // de-duplicated by Meta id (same account can be connected via two tokens).
      prisma.metaAdAccount.findMany({
        where: {
          selectedForSync: true,
          ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
        },
        select: {
          metaAdAccountId: true,
          name: true,
          currency: true,
          business: { select: { name: true } },
        },
        distinct: ["metaAdAccountId"],
        orderBy: [{ business: { name: "asc" } }, { name: "asc" }],
      }),
    ]);

  const newCampaignAccounts = accountsForCreate.map((a) => ({
    metaAdAccountId: a.metaAdAccountId,
    name: a.name,
    currency: a.currency,
    businessName: a.business.name,
  }));

  // Key by (adAccountInternalId, metaCampaignId) — same campaign id can exist
  // across different ad accounts in principle.
  const key = (acctId: string, campId: string) => `${acctId}::${campId}`;
  const metricsByCampaign = new Map(
    perCampaign.map((m) => [
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

  const campaigns: DisplayCampaign[] = rows.map((c) => {
    const m = metricsByCampaign.get(key(c.adAccount.id, c.metaCampaignId));
    const imps = m?.impressions ?? 0;
    const clks = m?.clicks ?? 0;
    return {
      id: c.metaCampaignId,
      adAccountId: c.adAccount.metaAdAccountId,
      businessId: c.adAccount.businessId,
      businessName: c.adAccount.business.name,
      adAccountName: c.adAccount.name,
      currency: c.adAccount.currency,
      name: c.name,
      status: c.status,
      objective: c.objective ?? "",
      dailyBudgetCents: c.dailyBudgetCents,
      lifetimeBudgetCents: c.lifetimeBudgetCents,
      spendCapCents: c.spendCapCents,
      spend7d: hasInsights ? (m?.spendCents ?? 0) / 100 : null,
      impressions: hasInsights ? imps : null,
      clicks: hasInsights ? clks : null,
      ctr: hasInsights ? (imps > 0 ? clks / imps : 0) : null,
      lastEdited: formatRelative(c.metaUpdatedTime),
    };
  });

  const totalAcrossAll = await prisma.campaign.count({
    where: { adAccount: { selectedForSync: true } },
  });

  // Build the export URL with the same scope the user is looking at.
  const exportQs = new URLSearchParams();
  if (client) exportQs.set("client", client);
  if (range) exportQs.set("range", range);
  const exportHref = `/api/campaigns/export.csv${
    exportQs.toString() ? `?${exportQs.toString()}` : ""
  }`;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-0.5 text-sm text-muted">
            {selectedBusiness ? (
              <>
                {campaigns.length} campaigns under{" "}
                <span className="text-foreground">{selectedBusiness.name}</span>{" "}
                · {activeCount} active · {pausedCount} paused
              </>
            ) : (
              <>
                {campaigns.length} campaigns across all connected clients ·{" "}
                {activeCount} active · {pausedCount} paused
              </>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <SearchBar placeholder="Search campaigns…" />
          <DateRangeDropdown />
          <BulkSyncButton
            kind="campaigns"
            accountsInScope={accountsForCreate.length}
            businessId={selectedBusiness?.id ?? null}
          />
          {/* Plain <a> for native download behavior — no client-side router. */}
          <a
            href={exportHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium hover:bg-surface-2 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export to CSV
          </a>
          <NewCampaignButton accounts={newCampaignAccounts} />
        </div>
      </div>

      {totalAcrossAll === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No campaigns synced yet"
          description="Drill into an ad account and click Sync now to pull campaigns from Meta."
          action={{
            label: "Go to accounts",
            href: "/dashboard/accounts",
          }}
        />
      ) : campaigns.length === 0 && query ? (
        <EmptyState
          icon={Megaphone}
          title={`No campaigns match “${query}”`}
          description="Try a shorter query, or clear the search to see all campaigns."
        />
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={`No campaigns under ${selectedBusiness?.name ?? "this client"}`}
          description="Switch clients in the top bar, or sync this client's ad accounts."
        />
      ) : (
        <FlatCampaignsTable campaigns={campaigns} />
      )}

      <p className="text-xs text-subtle">
        Spend / impressions / CTR aggregate {dateRange.label.toLowerCase()} of
        insights snapshots.
      </p>
    </div>
  );
}
