/**
 * GET /api/automation/accounts/[id]/media — recent IG media for the rule
 * editor's targeting dropdown. Live Meta passthrough, no mirror.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { listRecentMedia } from "@/lib/meta/instagram";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ig = await prisma.instagramAccount.findUnique({
    where: { id },
    select: { igUserId: true, connectionId: true },
  });
  if (!ig) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const media = await listRecentMedia(ig.connectionId, ig.igUserId);
    return NextResponse.json({ media });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
