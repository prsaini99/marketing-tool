"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  Banknote,
  ChevronRight,
  Pause,
  Pencil,
  Play,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getOptimizationGoalLabel, type FlatDisplayAdSet } from "@/lib/display";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { AdSetBudgetEditModal } from "@/components/adsets/budget-edit-modal";
import {
  EditAdSetModal,
  type EditableAdSet,
} from "@/components/adsets/edit-adset-modal";
import { DuplicateButton } from "@/components/common/duplicate-button";
import { DeleteButton } from "@/components/common/delete-button";

type BulkAction = "pause" | "activate" | "archive";

const ELIGIBLE_STATUS: Record<BulkAction, (status: string) => boolean> = {
  pause: (s) => s === "ACTIVE",
  activate: (s) => s === "PAUSED",
  archive: (s) => s !== "ARCHIVED" && s !== "DELETED",
};

const ACTION_META: Record<
  BulkAction,
  {
    verb: string;
    confirmLabel: string;
    variant: "neutral" | "danger";
    impact: string;
  }
> = {
  pause: {
    verb: "pause",
    confirmLabel: "Pause ad sets",
    variant: "neutral",
    impact:
      "They'll stop delivering on Meta. No data is lost — you can re-activate any time.",
  },
  activate: {
    verb: "activate",
    confirmLabel: "Activate ad sets",
    variant: "neutral",
    impact:
      "They'll resume delivering on Meta and start spending their budgets.",
  },
  archive: {
    verb: "archive",
    confirmLabel: "Archive ad sets",
    variant: "danger",
    impact:
      "They'll be archived on Meta. Historical data is preserved and Meta lets you un-archive later, but they'll disappear from active lists.",
  },
};

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatBudget(s: FlatDisplayAdSet) {
  if (s.dailyBudgetCents != null) {
    return `${formatMoney(s.dailyBudgetCents / 100, s.currency)} / day`;
  }
  if (s.lifetimeBudgetCents != null) {
    return `${formatMoney(s.lifetimeBudgetCents / 100, s.currency)} lifetime`;
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

interface FlatAdSetsTableProps {
  adSets: FlatDisplayAdSet[];
}

export function FlatAdSetsTable({ adSets }: FlatAdSetsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = searchParams.get("range");
  const querySuffix = range ? `?range=${range}` : "";
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const headerRef = useRef<HTMLInputElement>(null);

  const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [editing, setEditing] = useState<EditableAdSet | null>(null);

  async function runBulk(action: BulkAction) {
    setBulkLoading(true);
    setBulkError(null);
    try {
      const res = await fetch("/api/adsets/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          metaAdSetIds: Array.from(selectedIds),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      if (data.failed > 0) {
        setBulkError(
          `Done: ${data.ok} succeeded · ${data.failed} failed${
            data.skipped ? ` · ${data.skipped} skipped` : ""
          }`,
        );
        router.refresh();
        setSelectedIds(new Set());
      } else {
        setPendingAction(null);
        setSelectedIds(new Set());
        router.refresh();
      }
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBulkLoading(false);
    }
  }

  useEffect(() => {
    if (headerRef.current) {
      headerRef.current.indeterminate =
        selectedIds.size > 0 && selectedIds.size < adSets.length;
    }
  }, [selectedIds.size, adSets.length]);

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === adSets.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(adSets.map((s) => s.id)));
  }

  const allSelected =
    adSets.length > 0 && selectedIds.size === adSets.length;
  const hasSelection = selectedIds.size > 0;

  const selectedAdSets = adSets.filter((s) => selectedIds.has(s.id));
  const distinctClientCount = new Set(
    selectedAdSets.map((s) => s.businessId),
  ).size;

  function eligibleCount(action: BulkAction): number {
    return selectedAdSets.filter((s) => ELIGIBLE_STATUS[action](s.status)).length;
  }

  return (
    <div className="space-y-3">
      {hasSelection && (
        <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent-subtle px-3 py-2">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-semibold text-foreground">
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {(["pause", "activate", "archive"] as const).map((action) => {
              const eligible = eligibleCount(action);
              const disabled = eligible === 0;
              const Icon =
                action === "pause"
                  ? Pause
                  : action === "activate"
                    ? Play
                    : Archive;
              const danger = action === "archive";
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => setPendingAction(action)}
                  disabled={disabled}
                  title={
                    disabled
                      ? `No selected ad sets can be ${ACTION_META[action].verb}d`
                      : undefined
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    danger
                      ? "text-danger hover:bg-red-50"
                      : "hover:bg-surface-2",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {action === "pause"
                    ? "Pause"
                    : action === "activate"
                      ? "Activate"
                      : "Archive"}
                </button>
              );
            })}
            {(() => {
              const eligibleBudget = selectedAdSets.filter(
                (s) =>
                  s.dailyBudgetCents != null || s.lifetimeBudgetCents != null,
              ).length;
              const disabled = eligibleBudget === 0;
              return (
                <button
                  type="button"
                  onClick={() => setBudgetOpen(true)}
                  disabled={disabled}
                  title={
                    disabled
                      ? "No selected ad sets have a daily or lifetime budget"
                      : undefined
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-sm font-medium hover:bg-surface-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Banknote className="h-3.5 w-3.5" />
                  Edit budget
                </button>
              );
            })()}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-subtle">
              <th className="w-10 px-4 py-2.5">
                <input
                  ref={headerRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-blue-600"
                  aria-label="Select all ad sets"
                />
              </th>
              <th className="px-4 py-2.5">Ad set</th>
              <th className="px-4 py-2.5">Optimization goal</th>
              <th className="px-4 py-2.5">Budget</th>
              <th className="px-4 py-2.5 text-right">Spend</th>
              <th className="px-4 py-2.5 text-right">Impressions</th>
              <th className="px-4 py-2.5 text-right">CTR</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Last edited</th>
              <th className="w-20 px-4 py-2.5 text-right">Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {adSets.map((s) => {
              const isSelected = selectedIds.has(s.id);
              const accountIdNoPrefix = s.adAccountId.replace("act_", "");
              const href = `/dashboard/accounts/${accountIdNoPrefix}/campaigns/${s.campaignId}/adsets/${s.id}/ads${querySuffix}`;
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
                  className={cn(
                    "group cursor-pointer focus-visible:bg-surface focus-visible:outline-none transition-colors",
                    isSelected ? "bg-accent-subtle" : "hover:bg-surface",
                  )}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRow(s.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-blue-600"
                      aria-label={`Select ${s.name}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{s.name}</span>
                      <span className="text-xs text-subtle">
                        {s.businessName} · {s.adAccountName} · {s.campaignName}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">
                    {getOptimizationGoalLabel(s.optimizationGoal)}
                  </td>
                  <td className="px-4 py-3 text-sm tabular-nums">
                    {formatBudget(s)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium tabular-nums">
                    {s.spend != null ? (
                      formatMoney(s.spend, s.currency)
                    ) : (
                      <span className="font-normal text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums">
                    {s.impressions != null ? (
                      s.impressions.toLocaleString()
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums">
                    {s.ctr != null ? (
                      `${(s.ctr * 100).toFixed(2)}%`
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={s.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">
                    {s.lastEdited}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {/* Edit opens the modal; stopPropagation so neither the
                          row drill-down nor the checkbox toggles. */}
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
                            lifetimeBudgetCents: s.lifetimeBudgetCents,
                          });
                        }}
                        aria-label={`Edit ${s.name}`}
                        title="Edit ad set"
                        className="rounded-md p-1.5 text-subtle transition-colors hover:bg-surface-2 hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <DuplicateButton
                        level="adset"
                        metaId={s.id}
                        name={s.name}
                      />
                      <DeleteButton
                        entityType="adset"
                        metaId={s.id}
                        name={s.name}
                      />
                      <ChevronRight className="h-4 w-4 text-subtle transition-colors group-hover:text-foreground" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AdSetBudgetEditModal
        open={budgetOpen}
        selectedAdSets={selectedAdSets}
        onClose={() => setBudgetOpen(false)}
        onDone={() => {
          setBudgetOpen(false);
          setSelectedIds(new Set());
          router.refresh();
        }}
      />

      {editing && (
        <EditAdSetModal
          open={true}
          adSet={editing}
          // Currency is per ad account; pull it from the row being edited.
          currency={
            adSets.find((s) => s.id === editing.metaAdSetId)?.currency ?? "USD"
          }
          onClose={() => setEditing(null)}
        />
      )}

      {pendingAction && (() => {
        const meta = ACTION_META[pendingAction];
        const eligible = eligibleCount(pendingAction);
        const skipped = selectedIds.size - eligible;
        const title = `${
          meta.verb.charAt(0).toUpperCase() + meta.verb.slice(1)
        } ${eligible} ad set${eligible === 1 ? "" : "s"}?`;
        return (
          <ConfirmModal
            open={true}
            title={title}
            body={
              <div className="space-y-2">
                <p>
                  <span className="font-medium text-foreground">
                    {eligible}
                  </span>{" "}
                  ad set{eligible === 1 ? "" : "s"} across{" "}
                  <span className="font-medium text-foreground">
                    {distinctClientCount}
                  </span>{" "}
                  client{distinctClientCount === 1 ? "" : "s"} will be{" "}
                  {meta.verb}d. {meta.impact}
                </p>
                {skipped > 0 && (
                  <p className="rounded-md bg-surface px-3 py-2 text-xs">
                    <span className="font-medium text-foreground">
                      {skipped}
                    </span>{" "}
                    selected ad set{skipped === 1 ? "" : "s"}{" "}
                    {skipped === 1 ? "is" : "are"} already in the target state
                    and will be skipped.
                  </p>
                )}
              </div>
            }
            confirmLabel={meta.confirmLabel}
            variant={meta.variant}
            loading={bulkLoading}
            error={bulkError}
            onCancel={() => {
              if (bulkLoading) return;
              setPendingAction(null);
              setBulkError(null);
            }}
            onConfirm={() => runBulk(pendingAction)}
          />
        );
      })()}
    </div>
  );
}
