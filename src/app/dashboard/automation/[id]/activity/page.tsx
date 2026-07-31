/**
 * Account-level activity — the trust surface. Every webhook event with its
 * action rows: what came in, which rule matched, the exact text sent, skip
 * reasons, and Meta errors verbatim.
 *
 * This view deliberately shows events that matched NO rule (no_rule,
 * bot_disabled, opted_out). Those never appear in a per-rule view because
 * they have no matchedRuleId, and they are exactly what you need when the
 * question is "someone commented and the bot did nothing — why?".
 *
 * Rendering + filtering live in components/automation/activity-feed.tsx,
 * shared with the per-rule view so the two can't drift.
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

export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; action?: string; outcome?: string }>;
}) {
  const { id } = await params;
  const { status, action, outcome } = await searchParams;
  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: { id: true, displayName: true, platform: true },
  });
  if (!account) notFound();

  const filters = { status, action, outcome };
  const events = await prisma.automationEvent.findMany({
    where: buildActivityWhere(id, filters),
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actions: { orderBy: { createdAt: "asc" } } },
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Activity —{" "}
            {account.platform === "FACEBOOK"
              ? account.displayName
              : `@${account.displayName}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            Every event the bot received and exactly what it did about it,
            across all rules. Per-rule history lives inside each rule.
          </p>
        </div>
        <Link
          href={`/dashboard/automation/${id}/rules`}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Rules
        </Link>
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <ActivityFilterBar
          basePath={`/dashboard/automation/${id}/activity`}
          current={filters}
        />
      </div>

      <ActivityList
        events={events}
        showRuleId
        emptyMessage={
          status || action || outcome
            ? "No events match these filters."
            : "No events yet. Once webhooks are subscribed and the bot is on, every comment and DM shows up here within seconds."
        }
      />
    </div>
  );
}
