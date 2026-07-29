/**
 * Activity — the trust surface. Every webhook event with its action rows:
 * what came in, what matched, exact text sent, Meta errors, skip reasons.
 * Filters are plain links (server-rendered).
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  SENT: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  SKIPPED: "bg-surface text-muted-foreground border border-border",
  PENDING: "bg-amber-100 text-amber-800",
};

export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; action?: string }>;
}) {
  const { id } = await params;
  const { status, action } = await searchParams;
  const account = await prisma.instagramAccount.findUnique({
    where: { id },
    select: { id: true, username: true },
  });
  if (!account) notFound();

  const events = await prisma.automationEvent.findMany({
    where: {
      igAccountId: id,
      ...(status || action
        ? {
            actions: {
              some: {
                ...(status ? { status } : {}),
                ...(action ? { action } : {}),
              },
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actions: { orderBy: { createdAt: "asc" } } },
  });

  const filterLink = (label: string, s?: string, a?: string) => {
    const qs = new URLSearchParams();
    if (s) qs.set("status", s);
    if (a) qs.set("action", a);
    const href = `/dashboard/automation/${id}/activity${qs.size ? `?${qs}` : ""}`;
    const active = s === status && a === action;
    return (
      <Link
        key={label}
        href={href}
        className={`rounded-full px-3 py-1 text-xs ${active ? "bg-accent text-accent-foreground" : "border border-border"}`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Activity — @{account.username}
        </h1>
        <p className="text-sm text-muted-foreground">
          Every event the bot received and exactly what it did about it.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {filterLink("All", undefined, undefined)}
        {filterLink("Sent", "SENT", undefined)}
        {filterLink("Failed", "FAILED", undefined)}
        {filterLink("Skipped", "SKIPPED", undefined)}
        {filterLink("DMs", undefined, "DM")}
        {filterLink("Public replies", undefined, "PUBLIC_REPLY")}
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No events yet. Once webhooks are subscribed and the bot is on,
          every comment and DM shows up here within seconds.
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((e) => (
            <div key={e.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center justify-between text-sm">
                <div>
                  <span className="mr-2 rounded bg-background px-1.5 py-0.5 text-xs border border-border">
                    {e.eventType}
                  </span>
                  <span className="font-medium">
                    {e.fromUsername ? `@${e.fromUsername}` : (e.fromIgsid ?? "unknown")}
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    {(e.text ?? "").slice(0, 120)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {e.createdAt.toLocaleString("en-GB", { hour12: false })}
                </div>
              </div>
              {e.actions.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-border pt-2">
                  {e.actions.map((a) => (
                    <div key={a.id} className="flex items-start gap-2 text-xs">
                      <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[a.status] ?? ""}`}>
                        {a.status}
                      </span>
                      <span className="font-medium">{a.action}</span>
                      {a.renderedText && (
                        <span className="text-muted-foreground">“{a.renderedText.slice(0, 140)}”</span>
                      )}
                      {a.skipReason && <span className="text-muted-foreground">({a.skipReason})</span>}
                      {a.metaError && <span className="text-red-600">{a.metaError}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
