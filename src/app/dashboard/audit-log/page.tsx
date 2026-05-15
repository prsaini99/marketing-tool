/**
 * Audit log viewer.
 *
 * One unified page for every write we've performed on Meta — campaign/adset/ad
 * status changes and budget edits. Each bulk-op service writes an AuditLog row
 * BEFORE calling Meta (records intent) and stamps it again on success/failure.
 *
 * Filters: date range (?range=), target type (?target=), action kind (?action=).
 * Pagination via ?page= — 50 rows per page.
 *
 * Names are resolved by looking up the Meta entity (Campaign / AdSet / Ad)
 * by metaId. Some rows may resolve to "—" if the underlying entity was
 * deleted from Meta after the audit row was written — the log still tells
 * you what was done, which is the point of an audit log.
 */

import Link from "next/link";
import { ChevronLeft, ChevronRight, FileClock } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils";
import { resolveDateRange } from "@/lib/date-range";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { FilterDropdown } from "@/components/audit/filter-dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getActionKind,
  getActionLabel,
  getAuditStatus,
  getErrorMessage,
  summarizeChange,
  TARGET_TYPE_LABEL,
} from "@/lib/audit";

const PAGE_SIZE = 50;

const TARGET_OPTIONS = [
  { value: "all", label: "All targets" },
  { value: "campaign", label: "Campaigns" },
  { value: "adset", label: "Ad sets" },
  { value: "ad", label: "Ads" },
];

const ACTION_OPTIONS = [
  { value: "all", label: "All actions" },
  { value: "pause", label: "Paused" },
  { value: "activate", label: "Activated" },
  { value: "archive", label: "Archived" },
  { value: "budget", label: "Budget updated" },
];

function formatTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)} days ago`;
  return formatTime(d);
}

const STATUS_STYLE: Record<string, { pill: string; dot: string; label: string }> = {
  ok: { pill: "bg-green-50 text-green-700", dot: "bg-green-500", label: "Ok" },
  failed: { pill: "bg-red-50 text-red-700", dot: "bg-red-500", label: "Failed" },
  pending: { pill: "bg-blue-50 text-blue-700", dot: "bg-blue-500", label: "Pending" },
  unknown: { pill: "bg-zinc-100 text-zinc-600", dot: "bg-zinc-400", label: "—" },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.unknown;
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

interface ResolvedTarget {
  name: string | null;
  currency: string | null;
  // Deep-link back to the entity's drill-down page when we can build one.
  href: string | null;
}

// Map the action's prefix to the action filter value the dropdown emits.
const ACTION_FILTER_TO_SUFFIX: Record<string, string[]> = {
  pause: [".pause"],
  activate: [".activate"],
  archive: [".archive"],
  budget: [".budget_update"],
};

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    target?: string;
    action?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const dateRange = resolveDateRange(sp.range);
  const targetFilter = sp.target && sp.target !== "all" ? sp.target : null;
  const actionFilter = sp.action && sp.action !== "all" ? sp.action : null;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  // Filter clause — target type is a column; action suffix uses `endsWith`
  // since action values look like "campaign.pause" / "adset.budget_update".
  const where = {
    ...(dateRange.since ? { createdAt: { gte: dateRange.since } } : {}),
    ...(targetFilter ? { targetType: targetFilter } : {}),
    ...(actionFilter && ACTION_FILTER_TO_SUFFIX[actionFilter]
      ? {
          OR: ACTION_FILTER_TO_SUFFIX[actionFilter].map((suffix) => ({
            action: { endsWith: suffix },
          })),
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
  ]);

  // Bulk-resolve target names — one query per target type, indexed by metaId.
  const idsByType: Record<string, string[]> = {};
  for (const r of rows) {
    (idsByType[r.targetType] ??= []).push(r.targetId);
  }

  const [campaigns, adSets, ads] = await Promise.all([
    idsByType.campaign?.length
      ? prisma.campaign.findMany({
          where: { metaCampaignId: { in: idsByType.campaign } },
          select: {
            metaCampaignId: true,
            name: true,
            adAccount: {
              select: {
                currency: true,
                metaAdAccountId: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    idsByType.adset?.length
      ? prisma.adSet.findMany({
          where: { metaAdSetId: { in: idsByType.adset } },
          select: {
            metaAdSetId: true,
            name: true,
            campaign: { select: { metaCampaignId: true } },
            adAccount: {
              select: {
                currency: true,
                metaAdAccountId: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    idsByType.ad?.length
      ? prisma.ad.findMany({
          where: { metaAdId: { in: idsByType.ad } },
          select: {
            metaAdId: true,
            name: true,
            adSet: {
              select: {
                metaAdSetId: true,
                campaign: { select: { metaCampaignId: true } },
              },
            },
            adAccount: {
              select: {
                currency: true,
                metaAdAccountId: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const targetLookup = new Map<string, ResolvedTarget>();
  for (const c of campaigns) {
    const acctId = c.adAccount.metaAdAccountId.replace("act_", "");
    targetLookup.set(`campaign:${c.metaCampaignId}`, {
      name: c.name,
      currency: c.adAccount.currency,
      href: `/dashboard/accounts/${acctId}/campaigns/${c.metaCampaignId}/adsets`,
    });
  }
  for (const s of adSets) {
    const acctId = s.adAccount.metaAdAccountId.replace("act_", "");
    targetLookup.set(`adset:${s.metaAdSetId}`, {
      name: s.name,
      currency: s.adAccount.currency,
      href: `/dashboard/accounts/${acctId}/campaigns/${s.campaign.metaCampaignId}/adsets/${s.metaAdSetId}/ads`,
    });
  }
  for (const a of ads) {
    const acctId = a.adAccount.metaAdAccountId.replace("act_", "");
    targetLookup.set(`ad:${a.metaAdId}`, {
      name: a.name,
      currency: a.adAccount.currency,
      href: `/dashboard/accounts/${acctId}/campaigns/${a.adSet.campaign.metaCampaignId}/adsets/${a.adSet.metaAdSetId}/ads`,
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(total, page * PAGE_SIZE);

  // Build pagination links — preserve every other filter param.
  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (sp.range) params.set("range", sp.range);
    if (sp.target && sp.target !== "all") params.set("target", sp.target);
    if (sp.action && sp.action !== "all") params.set("action", sp.action);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/dashboard/audit-log${qs ? `?${qs}` : ""}`;
  }

  const hasFilters =
    Boolean(targetFilter) || Boolean(actionFilter) || sp.range !== undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
          <p className="mt-0.5 text-sm text-muted">
            Every Meta write the platform has performed. Recorded before each
            call — so failed ones are captured too.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <DateRangeDropdown />
          <FilterDropdown
            paramKey="target"
            defaultValue="all"
            options={TARGET_OPTIONS}
            iconName="tag"
          />
          <FilterDropdown
            paramKey="action"
            defaultValue="all"
            options={ACTION_OPTIONS}
            iconName="filter"
          />
        </div>
      </div>

      {total === 0 ? (
        <EmptyState
          icon={FileClock}
          title={
            hasFilters
              ? "No audit entries match these filters"
              : "No writes recorded yet"
          }
          description={
            hasFilters
              ? "Try widening the date range or clearing the target/action filters."
              : "Once you run any bulk pause/activate/archive/budget update, entries will appear here."
          }
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-subtle">
                  <th className="px-4 py-2.5">When</th>
                  <th className="px-4 py-2.5">Action</th>
                  <th className="px-4 py-2.5">Target</th>
                  <th className="px-4 py-2.5">Change</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const target = targetLookup.get(
                    `${r.targetType}:${r.targetId}`,
                  );
                  const status = getAuditStatus(r.after);
                  const change = summarizeChange(
                    r.action,
                    r.before,
                    r.after,
                    target?.currency ?? null,
                  );
                  const errMsg =
                    status === "failed" ? getErrorMessage(r.after) : null;
                  const kind = getActionKind(r.action);
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-surface transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-muted">
                        <div className="flex flex-col">
                          <span className="text-foreground">
                            {formatRelative(r.createdAt)}
                          </span>
                          <span className="text-xs text-subtle">
                            {formatTime(r.createdAt)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {getActionLabel(r.action)}
                          </span>
                          <span className="text-xs text-subtle">
                            {TARGET_TYPE_LABEL[r.targetType] ?? r.targetType} ·{" "}
                            {kind === "budget" ? "budget" : "status"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {target ? (
                          target.href ? (
                            <Link
                              href={target.href}
                              className="font-medium text-foreground hover:underline"
                            >
                              {target.name}
                            </Link>
                          ) : (
                            <span className="font-medium">{target.name}</span>
                          )
                        ) : (
                          <span className="text-subtle">— (deleted)</span>
                        )}
                        <div className="text-xs text-subtle">{r.targetId}</div>
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums">
                        {change ? (
                          <span className="text-muted">
                            <span className="text-foreground">{change.from}</span>{" "}
                            →{" "}
                            <span className="text-foreground">{change.to}</span>
                          </span>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={status} />
                        {errMsg && (
                          <p
                            className="mt-1 line-clamp-1 max-w-[280px] text-[11px] text-danger"
                            title={errMsg}
                          >
                            {errMsg}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              Showing <span className="text-foreground">{showingFrom}</span>–
              <span className="text-foreground">{showingTo}</span> of{" "}
              <span className="text-foreground">{total}</span>
            </span>
            <div className="flex items-center gap-1">
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 hover:bg-surface-2"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 opacity-50">
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </span>
              )}
              <span className="px-2">
                Page <span className="text-foreground">{page}</span> /{" "}
                {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={pageHref(page + 1)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 hover:bg-surface-2"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 opacity-50">
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
