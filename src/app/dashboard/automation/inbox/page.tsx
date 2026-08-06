/**
 * GET /dashboard/automation/inbox — global inbox entry point.
 *
 * There is no cross-account inbox view; every conversation lives under a
 * specific account at /dashboard/automation/<id>/inbox. This route exists
 * so the sidebar (and a Meta App Review reviewer following "open Inbox")
 * has one link that always lands somewhere real, without first having to
 * know which account the test conversation is on.
 *
 * Picks a target account, in order:
 *   1. The account owning the BotThread with the most recent lastInboundAt
 *      (i.e. "where did someone most recently message us") — the account a
 *      reviewer who just DM'd the Page would expect to land on.
 *   2. If no thread has lastInboundAt set (e.g. only comment-reply activity
 *      so far, never a DM), the account owning the most recently created
 *      thread. BotThread has no createdAt column, so `id: "desc"` stands in
 *      for recency — cuid()'s prefix is a timestamp, so it sorts the same
 *      way created_at would; the sibling inbox page already relies on this
 *      exact ordering as a tiebreaker.
 *   3. If there are no threads at all, the first SocialAccount by
 *      createdAt — better than a dead end, even if it has never seen a
 *      message.
 *   4. If there are no SocialAccount rows at all, redirect to the
 *      automation home rather than notFound() — a reviewer must never hit
 *      a 404.
 *
 * This is a static segment (`inbox/`) alongside the dynamic `[id]/`
 * segment. Next.js resolves static segments before dynamic ones, so this
 * page — not `[id]` with id="inbox" — handles `/dashboard/automation/inbox`.
 * SocialAccount ids are cuids, never the literal string "inbox", so that
 * collision can't arise the other way either.
 */

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function GlobalInboxPage() {
  const mostRecentInbound = await prisma.botThread.findFirst({
    where: { lastInboundAt: { not: null } },
    orderBy: { lastInboundAt: "desc" },
    select: { igAccountId: true },
  });

  const targetAccountId =
    mostRecentInbound?.igAccountId ??
    (
      await prisma.botThread.findFirst({
        orderBy: { id: "desc" },
        select: { igAccountId: true },
      })
    )?.igAccountId ??
    (
      await prisma.socialAccount.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })
    )?.id;

  if (!targetAccountId) {
    redirect("/dashboard/automation");
  }

  redirect(`/dashboard/automation/${targetAccountId}/inbox`);
}
