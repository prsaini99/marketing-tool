/**
 * POST /api/automation/accounts/[id]/subscribe — one-click webhook
 * subscription (comments + messages) once scopes are green. Stamps
 * webhookSubscribedAt on success.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { subscribeWebhooks } from "@/lib/meta/instagram";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ig = await prisma.instagramAccount.findUnique({
    where: { id },
    select: { igUserId: true, connectionId: true },
  });
  if (!ig) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await subscribeWebhooks(ig.connectionId, ig.igUserId);
    await prisma.instagramAccount.update({
      where: { id },
      data: { webhookSubscribedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
