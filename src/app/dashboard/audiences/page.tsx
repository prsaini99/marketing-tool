/**
 * Audiences library — every saved custom audience across selected accounts.
 *
 * A custom audience is a targeting shortcut (uploaded CRM list, pixel-tracked
 * site visitors, lookalikes, video viewers, …) that an ad set can include
 * or exclude in its targeting. The agency builds these in Ads Manager; we
 * mirror them so:
 *   • the senior can audit which audiences exist on each client account
 *   • the Create Ad Set picker has a dropdown to choose from
 *
 * Table view (not grid) — audiences are inherently text-heavy (name +
 * source + count), no thumbnail to anchor a card on.
 */

import { Users } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchBar } from "@/components/ui/search-bar";
import { BulkSyncButton } from "@/components/sync/bulk-sync-button";
import { NewAudienceButton } from "@/components/audiences/new-audience-button";
import { DeleteButton } from "@/components/common/delete-button";

// Meta's subtype enum → human label + pill color. The most common ones get
// distinct colors; anything new falls through to a neutral pill.
const SUBTYPE_STYLE: Record<string, { pill: string; label: string }> = {
  CUSTOM: { pill: "bg-blue-50 text-blue-700", label: "Customer list" },
  WEBSITE: { pill: "bg-green-50 text-green-700", label: "Pixel / website" },
  LOOKALIKE: { pill: "bg-purple-50 text-purple-700", label: "Lookalike" },
  ENGAGEMENT: { pill: "bg-amber-50 text-amber-700", label: "Engagement" },
  APP: { pill: "bg-pink-50 text-pink-700", label: "App activity" },
  VIDEO: { pill: "bg-rose-50 text-rose-700", label: "Video viewers" },
  OFFLINE_CONVERSION: {
    pill: "bg-teal-50 text-teal-700",
    label: "Offline events",
  },
  CLAIM: { pill: "bg-zinc-100 text-zinc-700", label: "Claim" },
};

function SubtypePill({ subtype }: { subtype: string | null }) {
  if (!subtype) {
    return (
      <span className="inline-flex items-center rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
        Unknown
      </span>
    );
  }
  const s = SUBTYPE_STYLE[subtype] ?? {
    pill: "bg-zinc-100 text-zinc-600",
    label:
      subtype.charAt(0) + subtype.slice(1).toLowerCase().replace(/_/g, " "),
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        s.pill,
      )}
    >
      {s.label}
    </span>
  );
}

// Meta returns several status strings — collapse to a small set of pills.
function statusLooksReady(status: string | null): boolean {
  if (!status) return false;
  const lower = status.toLowerCase();
  return lower.includes("ready") || lower.includes("normal");
}

function formatCount(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default async function AudiencesPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; q?: string }>;
}) {
  const { client, q } = await searchParams;
  const query = q?.trim();
  const selectedBusiness = client
    ? await prisma.metaBusiness.findUnique({
        where: { id: client },
        select: { id: true, name: true },
      })
    : null;

  const rows = await prisma.customAudience.findMany({
    where: {
      adAccount: {
        selectedForSync: true,
        ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
      },
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { description: { contains: query, mode: "insensitive" } },
              { metaAudienceId: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      adAccount: {
        select: {
          metaAdAccountId: true,
          name: true,
          business: { select: { name: true } },
        },
      },
    },
    orderBy: [{ adAccount: { name: "asc" } }, { name: "asc" }],
    take: 500,
  });

  const totalAcrossAll = await prisma.customAudience.count({
    where: { adAccount: { selectedForSync: true } },
  });

  // Accounts the user can create an audience under — scoped to the active
  // client filter, de-duped by Meta id (same account can come via 2 tokens).
  const scopeAccounts = await prisma.metaAdAccount.findMany({
    where: {
      selectedForSync: true,
      ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
    },
    select: {
      metaAdAccountId: true,
      name: true,
      business: { select: { name: true } },
    },
    distinct: ["metaAdAccountId"],
    orderBy: [{ business: { name: "asc" } }, { name: "asc" }],
  });
  const accountsInScope = scopeAccounts.length;
  const accountOptions = scopeAccounts.map((a) => ({
    metaAdAccountId: a.metaAdAccountId,
    name: a.name,
    businessName: a.business.name,
  }));

  const readyCount = rows.filter((r) => statusLooksReady(r.operationStatus))
    .length;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Audiences</h1>
          <p className="mt-0.5 text-sm text-muted">
            {selectedBusiness ? (
              <>
                {rows.length} saved audiences under{" "}
                <span className="text-foreground">{selectedBusiness.name}</span>
                {" "}· {readyCount} ready to use
              </>
            ) : (
              <>
                {rows.length} saved audiences across all connected clients ·{" "}
                {readyCount} ready to use
              </>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <SearchBar placeholder="Search name, description or id…" />
          <BulkSyncButton
            kind="audiences"
            accountsInScope={accountsInScope}
            businessId={selectedBusiness?.id ?? null}
          />
          <NewAudienceButton accounts={accountOptions} />
        </div>
      </div>

      {totalAcrossAll === 0 ? (
        <EmptyState
          icon={Users}
          title="No audiences synced yet"
          description="Click Sync now above to pull every saved custom audience from Meta for the selected accounts. They'll show up here and become available as targeting options on the Create Ad Set form."
        />
      ) : rows.length === 0 && query ? (
        <EmptyState
          icon={Users}
          title={`No audiences match “${query}”`}
          description="Try a shorter query, or clear the search to see all audiences."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={`No audiences under ${selectedBusiness?.name ?? "this client"}`}
          description="Switch clients in the top bar, or sync this client's ad accounts."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-subtle">
                <th className="px-4 py-2.5">Audience</th>
                <th className="px-4 py-2.5">Source</th>
                <th className="px-4 py-2.5 text-right">Approx. size</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Account</th>
                <th className="w-12 px-4 py-2.5 text-right">Delete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((a) => {
                const ready = statusLooksReady(a.operationStatus);
                return (
                  <tr key={a.id} className="hover:bg-surface transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span
                          className="text-sm font-medium text-foreground"
                          title={a.name}
                        >
                          {a.name}
                        </span>
                        {a.description && (
                          <span
                            className="line-clamp-1 text-xs text-muted"
                            title={a.description}
                          >
                            {a.description}
                          </span>
                        )}
                        <span
                          className="font-mono text-[10px] text-subtle"
                          title={a.metaAudienceId}
                        >
                          {a.metaAudienceId}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <SubtypePill subtype={a.subtype} />
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums">
                      {formatCount(a.approximateCount)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
                          ready
                            ? "bg-green-50 text-green-700"
                            : "bg-amber-50 text-amber-700",
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            ready ? "bg-green-500" : "bg-amber-500",
                          )}
                        />
                        {a.operationStatus ?? "Unknown"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      <div className="flex flex-col">
                        <span>{a.adAccount.business.name}</span>
                        <span className="text-subtle">{a.adAccount.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DeleteButton
                        entityType="audience"
                        metaId={a.metaAudienceId}
                        name={a.name}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-subtle">
        Showing up to 500 audiences. Audiences sync from Meta&apos;s
        /act_X/customaudiences endpoint — only audiences in &ldquo;ready&rdquo;
        status can be used as ad-set targeting.
      </p>
    </div>
  );
}
