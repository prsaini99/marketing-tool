/**
 * GET /api/videos?accountId=<act_... | ...>
 *
 * Returns the synced AdVideos for one account, used by the Create Ad video
 * picker. Reads from our local mirror (populated by the videos sync) — fast,
 * no Meta round-trip. A creative references the underlying video by id, and
 * Meta needs a poster (thumbnailUrl) to build a video creative, so we surface
 * status + thumbnail and let the picker disable anything not yet usable.
 *
 * Response: { videos: [{ videoId, title, thumbnailUrl, status, lengthSeconds }] }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const accountIdParam = url.searchParams.get("accountId");
  if (!accountIdParam) {
    return NextResponse.json(
      { error: "accountId query param is required" },
      { status: 400 },
    );
  }
  const metaAdAccountId = accountIdParam.startsWith("act_")
    ? accountIdParam
    : `act_${accountIdParam}`;

  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId, selectedForSync: true },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Ad account not found or not selected for sync" },
      { status: 404 },
    );
  }

  const videos = await prisma.adVideo.findMany({
    where: { adAccountId: account.id },
    select: {
      metaVideoId: true,
      title: true,
      thumbnailUrl: true,
      status: true,
      lengthSeconds: true,
    },
    orderBy: { syncedAt: "desc" },
    take: 500,
  });

  return NextResponse.json({
    videos: videos.map((v) => ({
      videoId: v.metaVideoId,
      title: v.title,
      thumbnailUrl: v.thumbnailUrl,
      status: v.status,
      lengthSeconds: v.lengthSeconds,
    })),
  });
}
