/**
 * GET /api/videos/[id]?accountId=<act_…> — read one video's LIVE status from
 * Meta (not our DB mirror, which stays PROCESSING until a sync). Used to poll
 * a just-uploaded video until it's `ready` with a poster so it can back an ad.
 *
 * Read-through: each successful read also refreshes the local AdVideo row, so
 * polling after an upload doubles as a per-video sync — the library reflects
 * `ready` + thumbnail without a separate "Sync now". Keeps Meta calls minimal
 * (the poll read we'd make anyway, no extra full-account sync).
 *
 * DELETE /api/videos/[id] — delete an ad video on Meta + remove the local
 * mirror. Meta rejects if the video is still used by a creative; surfaced
 * verbatim. `[id]` is the Meta video id.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { MetaApiError, metaClient } from "@/lib/meta/client";
import { deleteEntity } from "@/server/services/delete";
import { resolveUploadAccount } from "@/server/services/videos/upload";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing video id" }, { status: 400 });
  }
  const accountId = new URL(req.url).searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId query param is required" },
      { status: 400 },
    );
  }

  try {
    const account = await resolveUploadAccount(accountId);
    const video = await metaClient.getAdVideoById(account.connectionId, id);
    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    // Read-through refresh of the local mirror so the library auto-updates.
    await prisma.adVideo.upsert({
      where: {
        adAccountId_metaVideoId: {
          adAccountId: account.localId,
          metaVideoId: id,
        },
      },
      create: {
        adAccountId: account.localId,
        metaVideoId: id,
        title: video.title,
        description: video.description,
        thumbnailUrl: video.thumbnailUrl,
        sourceUrl: video.sourceUrl,
        lengthSeconds: video.lengthSeconds,
        status: video.status,
        metaCreatedTime: video.createdTime,
        syncedAt: new Date(),
      },
      update: {
        title: video.title,
        thumbnailUrl: video.thumbnailUrl,
        sourceUrl: video.sourceUrl,
        lengthSeconds: video.lengthSeconds,
        status: video.status,
        syncedAt: new Date(),
      },
    });

    return NextResponse.json({
      videoId: video.id,
      status: video.status,
      thumbnailUrl: video.thumbnailUrl,
      lengthSeconds: video.lengthSeconds,
      title: video.title,
    });
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("video status error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing video id" }, { status: 400 });
  }
  try {
    const result = await deleteEntity({ level: "video", metaId: id });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("delete video error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
