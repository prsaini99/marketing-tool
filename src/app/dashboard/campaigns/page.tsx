import { Megaphone } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { EmptyState } from "@/components/ui/empty-state";
import { FlatCampaignsTable } from "@/components/tables/flat-campaigns-table";
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
  searchParams: Promise<{ client?: string }>;
}) {
  const { client } = await searchParams;
  const selectedBusiness = client
    ? await prisma.metaBusiness.findUnique({
        where: { id: client },
        select: { id: true, name: true },
      })
    : null;

  const rows = await prisma.campaign.findMany({
    where: {
      adAccount: { selectedForSync: true },
      ...(selectedBusiness
        ? { adAccount: { selectedForSync: true, businessId: selectedBusiness.id } }
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
  });

  const activeCount = rows.filter((r) => r.status === "ACTIVE").length;
  const pausedCount = rows.filter((r) => r.status === "PAUSED").length;

  const campaigns: DisplayCampaign[] = rows.map((c) => ({
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
    spend7d: null,
    impressions: null,
    clicks: null,
    ctr: null,
    lastEdited: formatRelative(c.metaUpdatedTime),
  }));

  const totalAcrossAll = await prisma.campaign.count({
    where: { adAccount: { selectedForSync: true } },
  });

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
        Spend, impressions and CTR appear once Phase 1.2 (insights sync) ships.
      </p>
    </div>
  );
}
