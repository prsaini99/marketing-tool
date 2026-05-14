"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getObjectiveLabel, type DisplayCampaign } from "@/lib/display";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatBudget(campaign: DisplayCampaign, currency: string) {
  if (campaign.dailyBudgetCents != null) {
    return `${formatMoney(campaign.dailyBudgetCents / 100, currency)} / day`;
  }
  if (campaign.lifetimeBudgetCents != null) {
    return `${formatMoney(campaign.lifetimeBudgetCents / 100, currency)} lifetime`;
  }
  return "—";
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

interface CampaignsTableProps {
  campaigns: DisplayCampaign[];
  accountId: string;
  currency: string;
}

export function CampaignsTable({
  campaigns,
  accountId,
  currency,
}: CampaignsTableProps) {
  const router = useRouter();
  // Preserve the active range / client filters when drilling into ad sets,
  // so the user keeps the same window as they navigate deeper.
  const searchParams = useSearchParams();
  const range = searchParams.get("range");
  const querySuffix = range ? `?range=${range}` : "";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-subtle">
            <th className="px-4 py-2.5">Campaign</th>
            <th className="px-4 py-2.5">Objective</th>
            <th className="px-4 py-2.5">Budget</th>
            <th className="px-4 py-2.5 text-right">Spend</th>
            <th className="px-4 py-2.5 text-right">Impressions</th>
            <th className="px-4 py-2.5 text-right">CTR</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Last edited</th>
            <th className="w-8 px-4 py-2.5" aria-hidden="true" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {campaigns.map((c) => {
            const href = `/dashboard/accounts/${accountId}/campaigns/${c.id}/adsets${querySuffix}`;
            return (
              <tr
                key={c.id}
                role="link"
                tabIndex={0}
                onClick={() => router.push(href)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(href);
                  }
                }}
                className="group cursor-pointer hover:bg-surface focus-visible:bg-surface focus-visible:outline-none transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className="text-xs text-subtle">{c.id}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-muted">
                  {getObjectiveLabel(c.objective)}
                </td>
                <td className="px-4 py-3 text-sm tabular-nums">
                  {formatBudget(c, currency)}
                </td>
                <td className="px-4 py-3 text-right text-sm font-medium tabular-nums">
                  {c.spend7d != null ? (
                    formatMoney(c.spend7d, currency)
                  ) : (
                    <span className="font-normal text-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {c.impressions != null ? (
                    c.impressions.toLocaleString()
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {c.ctr != null ? (
                    `${(c.ctr * 100).toFixed(2)}%`
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={c.status} />
                </td>
                <td className="px-4 py-3 text-sm text-muted">{c.lastEdited}</td>
                <td className="px-4 py-3 text-right">
                  <ChevronRight className="ml-auto h-4 w-4 text-subtle transition-colors group-hover:text-foreground" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
