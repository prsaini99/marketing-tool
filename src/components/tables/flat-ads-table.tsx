"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  ChevronRight,
  Pause,
  Play,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getAdFormatLabel, type FlatDisplayAd } from "@/lib/display";
import { ConfirmModal } from "@/components/ui/confirm-modal";

type BulkAction = "pause" | "activate" | "archive";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

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
    confirmLabel: "Pause ads",
    variant: "neutral",
    impact:
      "They'll stop delivering on Meta. No data is lost — you can re-activate any time.",
  },
  activate: {
    verb: "activate",
    confirmLabel: "Activate ads",
    variant: "neutral",
    impact:
      "They'll resume delivering on Meta within their parent ad set's budget.",
  },
  archive: {
    verb: "archive",
    confirmLabel: "Archive ads",
    variant: "danger",
    impact:
      "They'll be archived on Meta. Historical data is preserved and Meta lets you un-archive later, but they'll disappear from active lists.",
  },
};

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

interface FlatAdsTableProps {
  ads: FlatDisplayAd[];
}

export function FlatAdsTable({ ads }: FlatAdsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = searchParams.get("range");
  const querySuffix = range ? `?range=${range}` : "";
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const headerRef = useRef<HTMLInputElement>(null);

  const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  async function runBulk(action: BulkAction) {
    setBulkLoading(true);
    setBulkError(null);
    try {
      const res = await fetch("/api/ads/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          metaAdIds: Array.from(selectedIds),
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
        selectedIds.size > 0 && selectedIds.size < ads.length;
    }
  }, [selectedIds.size, ads.length]);

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === ads.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(ads.map((a) => a.id)));
  }

  const allSelected = ads.length > 0 && selectedIds.size === ads.length;
  const hasSelection = selectedIds.size > 0;

  const selectedAds = ads.filter((a) => selectedIds.has(a.id));
  const distinctClientCount = new Set(
    selectedAds.map((a) => a.businessId),
  ).size;

  function eligibleCount(action: BulkAction): number {
    return selectedAds.filter((a) => ELIGIBLE_STATUS[action](a.status)).length;
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
                      ? `No selected ads can be ${ACTION_META[action].verb}d`
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
                  aria-label="Select all ads"
                />
              </th>
              <th className="px-4 py-2.5">Ad</th>
              <th className="px-4 py-2.5">Format</th>
              <th className="px-4 py-2.5 text-right">Spend</th>
              <th className="px-4 py-2.5 text-right">Impressions</th>
              <th className="px-4 py-2.5 text-right">CTR</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Last edited</th>
              <th className="w-8 px-4 py-2.5" aria-hidden="true" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ads.map((a) => {
              const isSelected = selectedIds.has(a.id);
              const accountIdNoPrefix = a.adAccountId.replace("act_", "");
              const href = `/dashboard/accounts/${accountIdNoPrefix}/campaigns/${a.campaignId}/adsets/${a.adSetId}/ads${querySuffix}`;
              return (
                <tr
                  key={a.id}
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
                      onChange={() => toggleRow(a.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-blue-600"
                      aria-label={`Select ${a.name}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{a.name}</span>
                      <span className="text-xs text-subtle">
                        {a.businessName} · {a.adAccountName} · {a.campaignName}{" "}
                        · {a.adSetName}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">
                    {getAdFormatLabel(a.format)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium tabular-nums">
                    {a.spend != null ? (
                      formatMoney(a.spend, a.currency)
                    ) : (
                      <span className="font-normal text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums">
                    {a.impressions != null ? (
                      a.impressions.toLocaleString()
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums">
                    {a.ctr != null ? (
                      `${(a.ctr * 100).toFixed(2)}%`
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={a.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">
                    {a.lastEdited}
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

      {pendingAction && (() => {
        const meta = ACTION_META[pendingAction];
        const eligible = eligibleCount(pendingAction);
        const skipped = selectedIds.size - eligible;
        const title = `${
          meta.verb.charAt(0).toUpperCase() + meta.verb.slice(1)
        } ${eligible} ad${eligible === 1 ? "" : "s"}?`;
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
                  ad{eligible === 1 ? "" : "s"} across{" "}
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
                    selected ad{skipped === 1 ? "" : "s"}{" "}
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
