"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { getOptimizationGoalLabel, type DisplayAdSet } from "@/lib/display";
import {
  EditAdSetModal,
  type EditableAdSet,
} from "@/components/adsets/edit-adset-modal";
import { DuplicateButton } from "@/components/common/duplicate-button";
import { DeleteButton } from "@/components/common/delete-button";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatBudget(adSet: DisplayAdSet, currency: string) {
  if (adSet.dailyBudgetCents != null) {
    return `${formatMoney(adSet.dailyBudgetCents / 100, currency)} / day`;
  }
  if (adSet.lifetimeBudgetCents != null) {
    return `${formatMoney(adSet.lifetimeBudgetCents / 100, currency)} lifetime`;
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

interface AdSetsTableProps {
  adSets: DisplayAdSet[];
  accountId: string;
  campaignId: string;
  currency: string;
}

export function AdSetsTable({
  adSets,
  accountId,
  campaignId,
  currency,
}: AdSetsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = searchParams.get("range");
  const querySuffix = range ? `?range=${range}` : "";

  const [editing, setEditing] = useState<EditableAdSet | null>(null);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-subtle">
            <th className="px-4 py-2.5">Ad set</th>
            <th className="px-4 py-2.5">Optimization goal</th>
            <th className="px-4 py-2.5">Budget</th>
            <th className="px-4 py-2.5 text-right">Spend</th>
            <th className="px-4 py-2.5 text-right">Results</th>
            <th className="px-4 py-2.5 text-right">Cost / result</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Last edited</th>
            <th className="w-20 px-4 py-2.5 text-right">Edit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {adSets.map((s) => {
            const href = `/dashboard/accounts/${accountId}/campaigns/${campaignId}/adsets/${s.id}/ads${querySuffix}`;
            return (
              <tr
                key={s.id}
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
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="text-xs text-subtle">{s.id}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-muted">
                  {getOptimizationGoalLabel(s.optimizationGoal)}
                </td>
                <td className="px-4 py-3 text-sm tabular-nums">
                  {formatBudget(s, currency)}
                </td>
                <td className="px-4 py-3 text-right text-sm font-medium tabular-nums">
                  {s.spend7d != null ? (
                    formatMoney(s.spend7d, currency)
                  ) : (
                    <span className="font-normal text-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {s.results != null ? (
                    s.results.toLocaleString()
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {s.costPerResultCents != null && s.costPerResultCents > 0 ? (
                    formatMoney(s.costPerResultCents / 100, currency)
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={s.status} />
                </td>
                <td className="px-4 py-3 text-sm text-muted">{s.lastEdited}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {/* Edit opens the modal; stopPropagation so the row's
                        drill-down navigation doesn't also fire. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing({
                          metaAdSetId: s.id,
                          name: s.name,
                          status: s.status,
                          optimizationGoal: s.optimizationGoal,
                          dailyBudgetCents: s.dailyBudgetCents,
                          lifetimeBudgetCents: s.lifetimeBudgetCents ?? null,
                        });
                      }}
                      aria-label={`Edit ${s.name}`}
                      title="Edit ad set"
                      className="rounded-md p-1.5 text-subtle transition-colors hover:bg-surface-2 hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <DuplicateButton level="adset" metaId={s.id} name={s.name} />
                    <DeleteButton entityType="adset" metaId={s.id} name={s.name} />
                    <ChevronRight className="h-4 w-4 text-subtle transition-colors group-hover:text-foreground" />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {editing && (
        <EditAdSetModal
          open={true}
          adSet={editing}
          currency={currency}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
