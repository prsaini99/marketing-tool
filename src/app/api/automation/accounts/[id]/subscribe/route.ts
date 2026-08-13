/**
 * POST /api/automation/accounts/[id]/subscribe — one-click webhook
 * subscription (comments + messages) once scopes are green. Stamps
 * webhookSubscribedAt on success.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { subscribeWebhooks } from "@/lib/meta/messaging";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ig = await prisma.socialAccount.findUnique({
    where: { id },
    select: { accountId: true, connectionId: true, linkedPageId: true },
  });
  if (!ig) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Webhook subscription is Page-scoped on the Facebook-Login flow.
  if (!ig.linkedPageId) {
    return NextResponse.json(
      {
        error:
          "No linked Facebook Page recorded for this account. Re-run Discover to capture the Page linkage.",
      },
      { status: 400 },
    );
  }
  try {
    await subscribeWebhooks(ig.connectionId, ig.linkedPageId);
    await prisma.socialAccount.update({
      where: { id },
      data: { webhookSubscribedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
