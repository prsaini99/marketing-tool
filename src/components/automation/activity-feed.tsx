/**
 * Shared activity feed — used by the account-level Activity page and by the
 * per-rule activity view. One component so the two surfaces can't drift:
 * the trust surface must render the same evidence wherever it appears.
 *
 * Server component (no "use client"): filters are plain links, so there is
 * no client JS and no hydration risk from the timestamps.
 */

import Link from "next/link";

const STATUS_STYLES: Record<string, string> = {
  SENT: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  SKIPPED: "bg-surface text-muted-foreground border border-border",
  PENDING: "bg-amber-100 text-amber-800",
};

export interface ActivityAction {
  id: string;
  action: string;
  status: string;
  skipReason: string | null;
  renderedText: string | null;
  metaError: string | null;
  matchedRuleId: string | null;
}

export interface ActivityEvent {
  id: string;
  eventId: string;
  eventType: string;
  fromUsername: string | null;
  fromIgsid: string | null;
  text: string | null;
  mediaId: string | null;
  createdAt: Date;
  actions: ActivityAction[];
}

export interface ActivityFilters {
  status?: string;
  action?: string;
  outcome?: string;
}

/** One filter pill row. `basePath` keeps per-rule vs account scoping intact. */
export function ActivityFilterBar({
  basePath,
  current,
}: {
  basePath: string;
  current: ActivityFilters;
}) {
  const pill = (
    label: string,
    next: ActivityFilters,
  ) => {
    const qs = new URLSearchParams();
    if (next.status) qs.set("status", next.status);
    if (next.action) qs.set("action", next.action);
    if (next.outcome) qs.set("outcome", next.outcome);
    const href = `${basePath}${qs.size ? `?${qs}` : ""}`;
    const active =
      (current.status ?? "") === (next.status ?? "") &&
      (current.action ?? "") === (next.action ?? "") &&
      (current.outcome ?? "") === (next.outcome ?? "");
    return (
      <Link
        key={label}
        href={href}
        className={`rounded-full px-3 py-1 text-xs ${
          active
            ? "bg-accent text-accent-foreground"
            : "border border-border hover:bg-surface"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground w-16">
          Outcome
        </span>
        {pill("All", {})}
        {pill("Sent", { status: "SENT" })}
        {pill("Failed", { status: "FAILED" })}
        {pill("Skipped", { status: "SKIPPED" })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground w-16">
          Action
        </span>
        {pill("Any", {})}
        {pill("DMs", { action: "DM" })}
        {pill("Comment DMs", { action: "DM_VIA_COMMENT" })}
        {pill("AI DMs", { action: "AI_DM" })}
        {pill("AI comment DMs", { action: "AI_DM_VIA_COMMENT" })}
        {pill("Public replies", { action: "PUBLIC_REPLY" })}
        {pill("AI replies", { action: "AI_PUBLIC_REPLY" })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground w-16">
          Why
        </span>
        {pill("Any reason", {})}
        {pill("Already messaged", { outcome: "once_per_user" })}
        {pill("No rule matched", { outcome: "no_rule" })}
        {pill("Bot was off", { outcome: "bot_disabled" })}
        {pill("Opted out", { outcome: "opted_out" })}
        {pill("Window expired", { outcome: "window_expired" })}
        {pill("Daily cap", { outcome: "daily_cap" })}
        {pill("No intent", { outcome: "no_intent" })}
        {pill("Negative keyword", { outcome: "negative_keyword" })}
        {pill("Complaint", { outcome: "complaint" })}
        {pill("Spam", { outcome: "spam" })}
        {pill("Noise", { outcome: "noise" })}
        {pill("Praise only", { outcome: "praise_only" })}
      </div>
    </div>
  );
}

export function ActivityList({
  events,
  emptyMessage,
  showRuleId = false,
}: {
  events: ActivityEvent[];
  emptyMessage: string;
  /** Account-level view shows which rule matched; per-rule view doesn't need it. */
  showRuleId?: boolean;
}) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((e) => (
        <div
          key={e.id}
          className="rounded-lg border border-border bg-surface p-4"
        >
          <div className="flex items-start justify-between gap-4 text-sm">
            <div className="min-w-0">
              <span className="mr-2 rounded bg-background px-1.5 py-0.5 text-xs border border-border">
                {e.eventType}
              </span>
              <span className="font-medium">
                {e.fromUsername
                  ? `@${e.fromUsername}`
                  : (e.fromIgsid ?? "unknown")}
              </span>
              <span className="ml-2 text-muted-foreground break-words">
                {(e.text ?? "").slice(0, 160)}
              </span>
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              {e.createdAt.toLocaleString("en-GB", { hour12: false })}
            </div>
          </div>
          {e.actions.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-border pt-2">
              {e.actions.map((a) => (
                <div key={a.id} className="flex flex-wrap items-start gap-2 text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      STATUS_STYLES[a.status] ?? ""
                    }`}
                  >
                    {a.status}
                  </span>
                  <span className="font-medium">{a.action}</span>
                  {a.renderedText && (
                    <span className="text-muted-foreground">
                      &ldquo;{a.renderedText.slice(0, 140)}&rdquo;
                    </span>
                  )}
                  {a.skipReason && (
                    <span className="text-muted-foreground">
                      ({a.skipReason})
                    </span>
                  )}
                  {a.metaError && (
                    <span className="text-red-600">{a.metaError}</span>
                  )}
                  {showRuleId && a.matchedRuleId && (
                    <span className="text-muted-foreground/70">
                      rule {a.matchedRuleId.slice(-6)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Build the Prisma `where` for an activity query.
 *
 * `outcome` filters on skipReason with a startsWith so "window_expired"
 * catches both window_expired and window_expired_comment.
 */
export function buildActivityWhere(
  igAccountId: string,
  filters: ActivityFilters,
  ruleId?: string,
) {
  const actionClause: Record<string, unknown> = {};
  if (filters.status) actionClause.status = filters.status;
  if (filters.action) actionClause.action = filters.action;
  if (filters.outcome) {
    actionClause.skipReason = { startsWith: filters.outcome };
  }
  if (ruleId) actionClause.matchedRuleId = ruleId;

  return {
    igAccountId,
    ...(Object.keys(actionClause).length > 0
      ? { actions: { some: actionClause } }
      : {}),
  };
}
