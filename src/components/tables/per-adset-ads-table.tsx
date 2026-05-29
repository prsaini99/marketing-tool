"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Image as ImageIcon,
  LayoutGrid,
  Layers,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getAdFormatLabel } from "@/lib/display";
import { AdPreviewButton } from "@/components/ads/ad-preview-button";

/**
 * Per-adset ads list. Row click navigates to the ad detail page where the
 * creative / image / video / per-ad insights live. The detail page is the
 * canonical drill-down — this table just stays compact and scannable so a
 * senior reviewing many ads can pick the one they want fast.
 */

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

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function statusStyle(status: string) {
  switch (status) {
    case "ACTIVE":
      return {
        pill: "bg-green-50 text-green-700",
        dot: "bg-green-500",
        label: "Active",
      };
    case "PAUSED":
      return {
        pill: "bg-amber-50 text-amber-700",
        dot: "bg-amber-500",
        label: "Paused",
      };
    case "DELETED":
      return {
        pill: "bg-red-50 text-red-700",
        dot: "bg-red-500",
        label: "Deleted",
      };
    case "ARCHIVED":
      return {
        pill: "bg-zinc-100 text-zinc-600",
        dot: "bg-zinc-400",
        label: "Archived",
      };
    default: {
      const label =
        status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
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

function formatIcon(format: string | null) {
  switch (format) {
    case "VIDEO":
      return Video;
    case "CAROUSEL":
      return LayoutGrid;
    case "COLLECTION":
      return Layers;
    default:
      return ImageIcon;
  }
}

// Shape the page passes per row. Only the bits the table renders — no
// joined creative/image/video here; that's the detail page's job.
export interface AdRow {
  id: string;            // local Ad.id
  metaAdId: string;
  name: string;
  status: string;
  format: string | null;
  creativeThumbnailUrl: string | null;
  metaUpdatedTime: Date | null;
  spendCents: number;
  impressions: number;
  clicks: number;
}

interface PerAdsetAdsTableProps {
  rows: AdRow[];
  currency: string;
  hasInsights: boolean;
  // Pieces of the destination URL — the table builds the link per row.
  accountIdUrl: string;     // unprefixed metaAdAccountId
  campaignId: string;       // metaCampaignId
  adsetId: string;          // metaAdSetId
  // Preserve the active range query param across the navigation so the
  // detail page lands on the same window.
  rangeQuery: string | null;
}

export function PerAdsetAdsTable({
  rows,
  currency,
  hasInsights,
  accountIdUrl,
  campaignId,
  adsetId,
  rangeQuery,
}: PerAdsetAdsTableProps) {
  const router = useRouter();
  const suffix = rangeQuery ? `?range=${rangeQuery}` : "";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-subtle">
            <th className="px-4 py-2.5">Ad</th>
            <th className="px-4 py-2.5">Format</th>
            <th className="px-4 py-2.5 text-right">Spend</th>
            <th className="px-4 py-2.5 text-right">Impressions</th>
            <th className="px-4 py-2.5 text-right">Clicks</th>
            <th className="px-4 py-2.5 text-right">CTR</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Last edited</th>
            <th className="w-12 px-4 py-2.5 text-right">Preview</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((a) => {
            const FormatIcon = formatIcon(a.format);
            const ctr =
              a.impressions > 0 ? a.clicks / a.impressions : 0;
            const href = `/dashboard/accounts/${accountIdUrl}/campaigns/${campaignId}/adsets/${adsetId}/ads/${a.metaAdId}${suffix}`;
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
                className="group cursor-pointer transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {a.creativeThumbnailUrl ? (
                      <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded ring-1 ring-border">
                        <Image
                          src={a.creativeThumbnailUrl}
                          alt={a.name}
                          fill
                          sizes="36px"
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-surface-2 ring-1 ring-border">
                        <FormatIcon className="h-4 w-4 text-subtle" />
                      </div>
                    )}
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{a.name}</span>
                      <span className="text-xs text-subtle">{a.metaAdId}</span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-muted">
                  {getAdFormatLabel(a.format)}
                </td>
                <td className="px-4 py-3 text-right text-sm font-medium tabular-nums">
                  {hasInsights ? (
                    formatMoney(a.spendCents / 100, currency)
                  ) : (
                    <span className="font-normal text-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {hasInsights ? (
                    a.impressions.toLocaleString()
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {hasInsights ? (
                    a.clicks.toLocaleString()
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {hasInsights ? (
                    `${(ctr * 100).toFixed(2)}%`
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={a.status} />
                </td>
                <td className="px-4 py-3 text-sm text-muted">
                  {formatRelative(a.metaUpdatedTime)}
                </td>
                {/* Preview button has its own onClick — stop bubbling so it
                    doesn't double-navigate to the detail page. */}
                <td
                  className="px-4 py-3 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <AdPreviewButton metaAdId={a.metaAdId} adName={a.name} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
