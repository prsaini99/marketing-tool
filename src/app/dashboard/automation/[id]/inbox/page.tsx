/**
 * Inbox — conversation view for a bot-automated Instagram/Facebook account.
 * Left pane lists BotThreads (flagged first — NULLS LAST is load-bearing
 * here, see the note below and the activity page, where the same bug was
 * found and fixed), right pane shows the selected thread's messages, lead,
 * and the operator actions (`InboxThread`, Task 4).
 *
 * This server component itself stays read-only: filters and thread
 * selection are plain `Link`s to search params, no mutations here. All
 * writes go through the `InboxThread` client component, which POSTs to
 * `/api/automation/threads/[threadId]`.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { replyWindowState } from "@/server/services/automation/inbox";
import { InboxThread } from "@/components/automation/inbox-thread";
import { AutoRefresh } from "@/components/automation/auto-refresh";

export const dynamic = "force-dynamic";

// Mirrors the activity page's FLAG_STYLES: ai_stuck/complaint are problems
// needing attention (amber), qualified is a positive outcome (green).
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

type ThreadFilter = "attention" | "human" | undefined;

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ thread?: string; filter?: string }>;
}) {
  const { id } = await params;
  const { thread: threadParam, filter: filterParam } = await searchParams;
  const filter: ThreadFilter =
    filterParam === "attention" || filterParam === "human"
      ? filterParam
      : undefined;

  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: { id: true, displayName: true, platform: true },
  });
  if (!account) notFound();

  // Filter in the DATABASE, not after the fact. `take: 100` caps the fetch,
  // so filtering the fetched array meant the filters silently operated on a
  // truncated set — past 100 threads, "Needs attention" could hide the very
  // rows it exists to surface. Same reason the pill counts below are real
  // COUNT(*)s rather than `.length` of a capped array.
  const ATTENTION_WHERE = { flagReason: { not: null }, resolvedAt: null };
  const HUMAN_WHERE = { ownership: "HUMAN" as const };

  const filterWhere =
    filter === "attention"
      ? ATTENTION_WHERE
      : filter === "human"
        ? HUMAN_WHERE
        : {};

  const orderBy = [
    // Postgres sorts DESC as NULLS FIRST, so without `nulls: "last"` every
    // unflagged thread would outrank flagged ones and the rows an operator
    // most needs to see would sink below the fold. Same fix as the leads &
    // flags section on the activity page.
    { flaggedAt: { sort: "desc" as const, nulls: "last" as const } },
    { lastInboundAt: { sort: "desc" as const, nulls: "last" as const } },
    { id: "desc" as const },
  ];

  const [filteredThreads, totalCount, attentionCount, humanCount] =
    await Promise.all([
      prisma.botThread.findMany({
        where: { igAccountId: account.id, ...filterWhere },
        include: { lead: true, _count: { select: { messages: true } } },
        orderBy,
        take: 100,
      }),
      prisma.botThread.count({ where: { igAccountId: account.id } }),
      prisma.botThread.count({
        where: { igAccountId: account.id, ...ATTENTION_WHERE },
      }),
      prisma.botThread.count({
        where: { igAccountId: account.id, ...HUMAN_WHERE },
      }),
    ]);

  // A `?thread=` that matches nothing — a stale bookmark, a thread from
  // another account, a deleted row — used to leave `selected` undefined and
  // render a blank pane with no explanation. Fall back to the first thread in
  // the current filter, exactly as the no-param case does.
  const selected =
    (threadParam
      ? await prisma.botThread.findFirst({
          where: { id: threadParam, igAccountId: account.id },
          include: { lead: true, _count: { select: { messages: true } } },
        })
      : null) ?? filteredThreads[0];
  const lead = selected?.lead ?? null;

  const messages = selected
    ? await prisma.botMessage.findMany({
        where: { threadId: selected.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 200,
      })
    : [];

  const filterHref = (next: ThreadFilter) => {
    const qs = new URLSearchParams();
    if (next) qs.set("filter", next);
    const query = qs.toString();
    return `/dashboard/automation/${id}/inbox${query ? `?${query}` : ""}`;
  };

  const threadHref = (threadId: string) => {
    const qs = new URLSearchParams();
    qs.set("thread", threadId);
    if (filter) qs.set("filter", filter);
    return `/dashboard/automation/${id}/inbox?${qs}`;
  };

  const filterPill = (label: string, value: ThreadFilter, count: number) => {
    const active = filter === value;
    return (
      <Link
        key={label}
        href={filterHref(value)}
        className={`rounded-full px-3 py-1 text-xs ${
          active
            ? "bg-accent text-accent-foreground"
            : "border border-border hover:bg-surface"
        }`}
      >
        {label} ({count})
      </Link>
    );
  };

  return (
    <div className="space-y-4 p-6">
      {/* Polls the server render so webhook-delivered messages appear on their
          own. Renders nothing; see the component for why polling and not a
          socket. */}
      <AutoRefresh />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Inbox —{" "}
            {account.platform === "FACEBOOK"
              ? account.displayName
              : `@${account.displayName}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            Every bot conversation for this account. Select a thread to take
            it over, hand it back, resolve it, or reply.
          </p>
        </div>
        <Link
          href={`/dashboard/automation/${id}/activity`}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Activity
        </Link>
      </div>

      {totalCount === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No conversations yet. Threads appear here once the bot exchanges
          DMs or comment replies with a contact.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          {/* Left pane: thread list */}
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {filterPill("Needs attention", "attention", attentionCount)}
              {filterPill("Human-owned", "human", humanCount)}
              {filterPill("All", undefined, totalCount)}
            </div>

            {filteredThreads.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No threads match this filter.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredThreads.map((t) => (
                  <Link
                    key={t.id}
                    href={threadHref(t.id)}
                    className={`block rounded-md border p-3 text-sm ${
                      selected?.id === t.id
                        ? "border-accent bg-accent-subtle"
                        : "border-border bg-surface hover:bg-surface-2"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {t.username ? `@${t.username}` : t.igsid}
                      </span>
                      {t.username && (
                        <span className="text-xs text-muted-foreground">
                          {t.igsid}
                        </span>
                      )}
                      {t.flagReason && !t.resolvedAt && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            FLAG_STYLES[t.flagReason] ??
                            "bg-surface text-muted-foreground border border-border"
                          }`}
                        >
                          {t.flagReason}
                        </span>
                      )}
                      {t.ownership === "HUMAN" && (
                        <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                          HUMAN
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {t.lead && (
                        <span className="rounded-full border border-border px-2 py-0.5">
                          {t.lead.stage}
                        </span>
                      )}
                      <span>{t._count.messages} messages</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Right pane: conversation + lead */}
          <div className="space-y-4">
            {!selected ? (
              <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                No thread selected.
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {selected.username ? `@${selected.username}` : selected.igsid}
                      </span>
                      {selected.username && (
                        <span className="text-xs text-muted-foreground">
                          {selected.igsid}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                        {selected.ownership === "HUMAN"
                          ? "Human-owned"
                          : "Bot-owned"}
                      </span>
                      {selected.optedOut && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                          Opted out
                        </span>
                      )}
                    </div>
                  </div>

                  {messages.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      No messages recorded for this thread.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {messages.map((m) => {
                        const isUser = m.role === "USER";
                        const isHumanMsg = m.role === "HUMAN";
                        return (
                          <div
                            key={m.id}
                            className={`flex ${isUser ? "justify-start" : "justify-end"}`}
                          >
                            <div
                              className={`max-w-[75%] rounded-lg border p-2.5 text-sm ${
                                isUser
                                  ? "border-border bg-background"
                                  : isHumanMsg
                                    ? "border-accent bg-accent text-accent-foreground"
                                    : "border-border bg-surface-2"
                              }`}
                            >
                              <div
                                className={`mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide ${
                                  isHumanMsg
                                    ? "text-accent-foreground/80"
                                    : "text-muted-foreground"
                                }`}
                              >
                                <span>{m.role}</span>
                                {m.channel === "COMMENT" && (
                                  <span className="rounded-full border border-current px-1.5 py-0 normal-case">
                                    Comment
                                  </span>
                                )}
                                <span className="ml-auto font-normal normal-case">
                                  {m.createdAt.toLocaleString("en-GB", {
                                    hour12: false,
                                  })}
                                </span>
                              </div>
                              <div className="whitespace-pre-wrap break-words">
                                {m.text}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <InboxThread
                  threadId={selected.id}
                  ownership={selected.ownership === "HUMAN" ? "HUMAN" : "BOT"}
                  lastInboundAt={selected.lastInboundAt}
                  windowState={replyWindowState(selected.lastInboundAt)}
                  // Same predicate the Needs attention filter uses, so the
                  // button appears exactly when the thread is in that queue.
                  flagged={Boolean(selected.flagReason) && !selected.resolvedAt}
                />

                <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
                  <h2 className="text-sm font-semibold">Lead</h2>
                  {!lead ? (
                    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      No lead captured for this thread yet.
                    </div>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        {lead.stage}
                      </span>
                      {LEAD_FIELD_LABELS.some(([key]) => lead[key]) ? (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {LEAD_FIELD_LABELS.filter(([key]) => lead[key]).map(
                            ([key, label]) => (
                              <span key={key}>
                                <span className="font-medium text-foreground">
                                  {label}:
                                </span>{" "}
                                {lead[key]}
                              </span>
                            ),
                          )}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          No lead fields extracted yet.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
