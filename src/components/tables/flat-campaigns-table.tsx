"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Banknote,
  ChevronRight,
  Pause,
  Play,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getObjectiveLabel, type DisplayCampaign } from "@/lib/display";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { BudgetEditModal } from "@/components/campaigns/budget-edit-modal";

type BulkAction = "pause" | "activate" | "archive";

// Per-action: which current statuses are eligible? Used to disable buttons
// when no selected campaigns can possibly change, and to split the confirm
// modal copy into "will change" vs "already in target / skipped".
const ELIGIBLE_STATUS: Record<BulkAction, (status: string) => boolean> = {
  pause: (s) => s === "ACTIVE",
  activate: (s) => s === "PAUSED",
  archive: (s) => s !== "ARCHIVED" && s !== "DELETED",
};

const ACTION_META: Record<
  BulkAction,
  {
    verb: string; // "pause" / "activate" / "archive"
    confirmLabel: string;
    variant: "neutral" | "danger";
    impact: string; // sentence about what happens to eligible ones
  }
> = {
  pause: {
    verb: "pause",
    confirmLabel: "Pause campaigns",
    variant: "neutral",
    impact:
      "They'll stop delivering ads on Meta. No data is lost — you can re-activate any time.",
  },
  activate: {
    verb: "activate",
    confirmLabel: "Activate campaigns",
    variant: "neutral",
    impact:
      "They'll resume delivering ads on Meta and start spending their assigned budgets.",
  },
  archive: {
    verb: "archive",
    confirmLabel: "Archive campaigns",
    variant: "danger",
    impact:
      "They'll be archived on Meta. Historical data is preserved and Meta lets you un-archive later, but they'll disappear from your active lists.",
  },
};

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatBudget(campaign: DisplayCampaign) {
  if (campaign.dailyBudgetCents != null) {
    return `${formatMoney(campaign.dailyBudgetCents / 100, campaign.currency)} / day`;
  }
  if (campaign.lifetimeBudgetCents != null) {
    return `${formatMoney(campaign.lifetimeBudgetCents / 100, campaign.currency)} lifetime`;
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

interface FlatCampaignsTableProps {
  campaigns: DisplayCampaign[];
}

export function FlatCampaignsTable({ campaigns }: FlatCampaignsTableProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const headerRef = useRef<HTMLInputElement>(null);

  // Bulk-action state: tracks which action's confirm modal is open + the
  // in-flight + error state for the API call.
  const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);

  async function runBulk(action: BulkAction) {
    setBulkLoading(true);
    setBulkError(null);
    try {
      const res = await fetch("/api/campaigns/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          metaCampaignIds: Array.from(selectedIds),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      // Partial failures: leave the modal open with a summary so the user
      // can see what worked and what didn't, then dismiss manually.
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

  // Native checkboxes can't show an "indeterminate" state via attribute;
  // it must be set as a property on the DOM node.
  useEffect(() => {
    if (headerRef.current) {
      headerRef.current.indeterminate =
        selectedIds.size > 0 && selectedIds.size < campaigns.length;
    }
  }, [selectedIds.size, campaigns.length]);

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === campaigns.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(campaigns.map((c) => c.id)));
    }
  }

  const allSelected =
    campaigns.length > 0 && selectedIds.size === campaigns.length;
  const hasSelection = selectedIds.size > 0;

  const selectedCampaigns = campaigns.filter((c) => selectedIds.has(c.id));
  const distinctClientCount = new Set(
    selectedCampaigns.map((c) => c.businessId),
  ).size;

  // How many of the selected campaigns can each action actually affect?
  // Powers both the button disabled state and the modal's preview.
  function eligibleCount(action: BulkAction): number {
    return selectedCampaigns.filter((c) => ELIGIBLE_STATUS[action](c.status))
      .length;
  }

  return (
    <div className="space-y-3">
      {/* Bulk action toolbar */}
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
                      ? `No selected campaigns can be ${ACTION_META[action].verb}d`
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
              // Eligible if the campaign has EITHER a daily or lifetime budget —
              // the modal lets the user pick which one to edit.
              const eligibleBudget = selectedCampaigns.filter(
                (c) =>
                  c.dailyBudgetCents != null || c.lifetimeBudgetCents != null,
              ).length;
              const disabled = eligibleBudget === 0;
              return (
                <button
                  type="button"
                  onClick={() => setBudgetOpen(true)}
                  disabled={disabled}
                  title={
                    disabled
                      ? "No selected campaigns have a daily or lifetime budget"
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
                  aria-label="Select all campaigns"
                />
              </th>
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
              const isSelected = selectedIds.has(c.id);
              const accountIdNoPrefix = c.adAccountId.replace("act_", "");
              const href = `/dashboard/accounts/${accountIdNoPrefix}/campaigns/${c.id}/adsets`;
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
                  className={cn(
                    "group cursor-pointer focus-visible:bg-surface focus-visible:outline-none transition-colors",
                    isSelected ? "bg-accent-subtle" : "hover:bg-surface",
                  )}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRow(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-blue-600"
                      aria-label={`Select ${c.name}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{c.name}</span>
                      <span className="text-xs text-subtle">
                        {c.businessName} · {c.adAccountName}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">
                    {getObjectiveLabel(c.objective)}
                  </td>
                  <td className="px-4 py-3 text-sm tabular-nums">
                    {formatBudget(c)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium tabular-nums">
                    {c.spend7d != null ? (
                      formatMoney(c.spend7d, c.currency)
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
                  <td className="px-4 py-3 text-sm text-muted">
                    {c.lastEdited}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight className="ml-auto h-4 w-4 text-subtle transition-colors group-hover:text-foreground" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <BudgetEditModal
        open={budgetOpen}
        selectedCampaigns={selectedCampaigns}
        onClose={() => setBudgetOpen(false)}
        onDone={() => {
          setBudgetOpen(false);
          setSelectedIds(new Set());
          router.refresh();
        }}
      />

      {pendingAction && (() => {
        const meta = ACTION_META[pendingAction];
        const eligible = eligibleCount(pendingAction);
        const skipped = selectedIds.size - eligible;
        const title = `${
          meta.verb.charAt(0).toUpperCase() + meta.verb.slice(1)
        } ${eligible} campaign${eligible === 1 ? "" : "s"}?`;
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
                  campaign{eligible === 1 ? "" : "s"} across{" "}
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
                    selected campaign{skipped === 1 ? "" : "s"}{" "}
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
