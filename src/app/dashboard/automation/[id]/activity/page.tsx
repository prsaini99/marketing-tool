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

// flagReason is ai_stuck | complaint | qualified. The first two are problems
// needing attention (warning treatment); qualified is a positive outcome
// (green), matching the webhookOn pill on the automation home page.
const FLAG_STYLES: Record<string, string> = {
  ai_stuck: "bg-amber-100 text-amber-800",
  complaint: "bg-amber-100 text-amber-800",
  qualified: "bg-green-100 text-green-800",
};

const LEAD_FIELD_LABELS = [
  ["requirement", "Requirement"],
  ["budget", "Budget"],
  ["timeline", "Timeline"],
  ["name", "Name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["company", "Company"],
] as const;

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

  const leadThreads = await prisma.botThread.findMany({
    where: {
      igAccountId: account.id,
      OR: [{ lead: { isNot: null } }, { flagReason: { not: null } }],
    },
    include: { lead: true },
    // NULLS LAST is load-bearing, not cosmetic. Postgres sorts NULLs FIRST on
    // DESC, and the engine creates a BotLead row for every intent-bearing
    // thread — including an all-null one at stage NEW. Plain
    // `{ flaggedAt: "desc" }` therefore ranked every unflagged, empty thread
    // ABOVE the flagged ones, and past 50 threads the flagged ones — the only
    // rows an operator actually needs to see — fell off the page entirely.
    // Secondary id sort keeps the order stable among the unflagged tail.
    orderBy: [{ flaggedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: 50,
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Activity:{" "}
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

      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <h2 className="text-sm font-semibold">Leads &amp; flags</h2>
        {leadThreads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No leads or flagged threads yet. Qualification runs
            automatically as the bot chats with contacts.
          </div>
        ) : (
          <div className="space-y-2">
            {leadThreads.map((t) => {
              const lead = t.lead;
              const fields = lead
                ? LEAD_FIELD_LABELS.filter(([key]) => lead[key])
                : [];
              return (
                <div
                  key={t.id}
                  className="rounded-md border border-border p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Mirrors the inbox's presentation: @handle as the
                        primary identifier with the raw igsid as secondary
                        text, falling back to the bare id when no username was
                        ever captured (DM webhooks don't carry one). */}
                    <span className="font-medium">
                      {t.username ? `@${t.username}` : t.igsid}
                    </span>
                    {t.username && (
                      <span className="text-xs text-muted-foreground">
                        {t.igsid}
                      </span>
                    )}
                    {t.flagReason && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          FLAG_STYLES[t.flagReason] ??
                          "bg-surface text-muted-foreground border border-border"
                        }`}
                      >
                        {t.flagReason}
                      </span>
                    )}
                    {lead && (
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        {lead.stage}
                      </span>
                    )}
                  </div>
                  {fields.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {fields.map(([key, label]) => (
                        <span key={key}>
                          <span className="font-medium text-foreground">
                            {label}:
                          </span>{" "}
                          {lead![key]}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
