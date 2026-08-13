/**
 * Per-rule activity — only events where THIS rule matched, so a rule can be
 * monitored in isolation.
 *
 * Note what is deliberately absent: events that matched no rule at all
 * (no_rule / bot_disabled / opted_out) carry matchedRuleId = null, so they
 * cannot appear here. The account-level Activity view is where those live,
 * and this page links to it so a missing event is one click away.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import {
  ActivityFilterBar,
  ActivityList,
  buildActivityWhere,
} from "@/components/automation/activity-feed";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function RuleActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; ruleId: string }>;
  searchParams: Promise<{ status?: string; action?: string; outcome?: string }>;
}) {
  const { id, ruleId } = await params;
  const { status, action, outcome } = await searchParams;

  const [account, rule] = await Promise.all([
    prisma.socialAccount.findUnique({
      where: { id },
      select: { id: true, displayName: true, platform: true },
    }),
    prisma.botRule.findUnique({
      where: { id: ruleId },
      select: {
        id: true,
        igAccountId: true,
        enabled: true,
        priority: true,
        triggerType: true,
        keywords: true,
        mediaId: true,
        publicReplyEnabled: true,
        dmEnabled: true,
        oncePerUser: true,
      },
    }),
  ]);
  // Guard against a ruleId from another account being read through this path.
  if (!account || !rule || rule.igAccountId !== id) notFound();

  const filters = { status, action, outcome };
  const events = await prisma.automationEvent.findMany({
    where: buildActivityWhere(id, filters, ruleId),
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      actions: { where: { matchedRuleId: ruleId }, orderBy: { createdAt: "asc" } },
    },
  });

  // Headline counters for this rule over the last 24h.
  const since = new Date(Date.now() - DAY_MS);
  const recent = await prisma.automationLog.findMany({
    where: { matchedRuleId: ruleId, createdAt: { gt: since } },
    select: { action: true, status: true },
  });
  const sent = recent.filter((r) => r.status === "SENT").length;
  const failed = recent.filter((r) => r.status === "FAILED").length;
  const skipped = recent.filter((r) => r.status === "SKIPPED").length;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Rule activity:{" "}
            {account.platform === "FACEBOOK"
              ? account.displayName
              : `@${account.displayName}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            Only events this rule matched. Events that matched no rule appear
            in{" "}
            <Link
              href={`/dashboard/automation/${id}/activity`}
              className="underline"
            >
              account activity
            </Link>
            .
          </p>
        </div>
        <Link
          href={`/dashboard/automation/${id}/rules`}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Back to rules
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            rule.enabled
              ? "bg-green-100 text-green-800"
              : "bg-surface text-muted-foreground border border-border"
          }`}
        >
          {rule.enabled ? "Enabled" : "Disabled"}
        </span>
        <span className="text-muted-foreground">prio {rule.priority}</span>
        <span className="font-medium">{rule.triggerType}</span>
        {rule.keywords.length > 0 && (
          <span className="text-muted-foreground">
            {rule.keywords.map((k) => (
              <span
                key={k}
                className="mr-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
              >
                {k}
              </span>
            ))}
          </span>
        )}
        <span className="text-muted-foreground text-xs">
          {rule.mediaId ? `media ${rule.mediaId}` : "all media"}
        </span>
        <span className="text-muted-foreground text-xs">
          {[
            rule.publicReplyEnabled ? "reply" : null,
            rule.dmEnabled ? "DM" : null,
            rule.oncePerUser ? "once/user" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          24h: {sent} sent · {skipped} skipped
          {failed > 0 ? ` · ${failed} FAILED` : ""}
        </span>
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <ActivityFilterBar
          basePath={`/dashboard/automation/${id}/rules/${ruleId}/activity`}
          current={filters}
        />
      </div>

      <ActivityList
        events={events}
        emptyMessage={
          status || action || outcome
            ? "No events match these filters for this rule."
            : "This rule hasn't matched anything yet."
        }
      />
    </div>
  );
}
