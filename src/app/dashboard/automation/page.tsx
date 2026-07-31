/**
 * Automation home — one card per discovered IG account: bot toggle, setup
 * badge, last-24h activity counts, links to rules/profile/activity/setup.
 * Server component; reads come straight from prisma (repo convention).
 */

import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { DiscoverButton } from "@/components/automation/discover-button";
import { BotToggle } from "@/components/automation/bot-toggle";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function AutomationHome() {
  const accounts = await prisma.socialAccount.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      connection: { select: { id: true, label: true, tokenOwnerName: true } },
    },
  });
  const connections = await prisma.connection.findMany({
    select: { id: true },
  });

  const since = new Date(Date.now() - DAY_MS);
  const recentLogs = await prisma.automationLog.findMany({
    where: { createdAt: { gt: since } },
    select: {
      action: true,
      status: true,
      event: { select: { igAccountId: true } },
    },
    take: 1000,
  });

  const countsByAccount = new Map<
    string,
    { dms: number; replies: number; skipped: number; failed: number }
  >();
  for (const log of recentLogs) {
    const key = log.event.igAccountId;
    const c = countsByAccount.get(key) ?? {
      dms: 0,
      replies: 0,
      skipped: 0,
      failed: 0,
    };
    if (log.status === "FAILED") c.failed += 1;
    else if (log.status === "SKIPPED" || log.action === "SKIPPED") c.skipped += 1;
    else if (["DM", "AI_DM", "DM_VIA_COMMENT", "AI_DM_VIA_COMMENT"].includes(
        log.action,
      )) c.dms += 1;
    else c.replies += 1;
    countsByAccount.set(key, c);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Automation</h1>
          <p className="text-sm text-muted-foreground">
            Instagram comment &amp; DM bot. Discover accounts, then set up
            rules, the bot profile, and webhooks per account.
          </p>
        </div>
        <DiscoverButton connectionIds={connections.map((c) => c.id)} />
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No Instagram accounts discovered yet. Click &quot;Discover Instagram
          accounts&quot; — your token needs instagram_basic + a linked Facebook
          Page (see the setup page after discovery).
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => {
            const c = countsByAccount.get(a.id) ?? {
              dms: 0,
              replies: 0,
              skipped: 0,
              failed: 0,
            };
            return (
              <div
                key={a.id}
                className="rounded-lg border border-border bg-surface p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">
                        {a.platform === "FACEBOOK" ? a.displayName : `@${a.displayName}`}
                      </span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {a.platform === "FACEBOOK" ? "Facebook" : "Instagram"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.connection.label ?? a.connection.tokenOwnerName ?? "connection"}
                    </div>
                  </div>
                  <BotToggle
                    accountId={a.id}
                    username={a.displayName}
                    botEnabled={a.botEnabled}
                    platform={a.platform}
                  />
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      a.webhookSubscribedAt
                        ? "bg-green-100 text-green-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {a.webhookSubscribedAt ? "Webhooks on" : "Setup needed"}
                  </span>
                  <span className="text-muted-foreground">
                    24h: {c.dms} DMs · {c.replies} replies · {c.skipped} skipped
                    {c.failed > 0 ? ` · ${c.failed} FAILED` : ""}
                  </span>
                </div>
                <div className="flex gap-2 text-sm">
                  <Link href={`/dashboard/automation/${a.id}/rules`} className="rounded-md border border-border px-2 py-1">Rules</Link>
                  <Link href={`/dashboard/automation/${a.id}/profile`} className="rounded-md border border-border px-2 py-1">Bot profile</Link>
                  <Link href={`/dashboard/automation/${a.id}/activity`} className="rounded-md border border-border px-2 py-1">Activity</Link>
                  <Link href={`/dashboard/automation/${a.id}/setup`} className="rounded-md border border-border px-2 py-1">Setup</Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
