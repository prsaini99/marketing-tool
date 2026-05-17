/**
 * Pulls raw videos from one ad account's library and upserts them into our
 * AdVideo table. Two passes:
 *
 *   1. GET /act_X/advideos — videos uploaded directly to the ad account.
 *   2. For every videoId referenced by an AdCreative in this account that
 *      isn't yet in AdVideo, fetch it individually via GET /{video_id}.
 *      This catches Facebook Page videos used in ads — Meta does NOT return
 *      those in /advideos, so without this second pass any ad whose creative
 *      uses a Page video would forever show "video not synced" in the UI.
 *
 * Both passes upsert by (adAccountId, metaVideoId) so re-runs are
 * idempotent. SyncLog kind = "videos" for both — they're one logical sync.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient } from "@/lib/meta/client";
import type { NormalizedAdVideo } from "@/lib/meta/types";

export interface SyncVideosResult {
  adAccountId: string;
  upserted: number;
  syncLogId: string;
}

export async function syncVideosForAccount(
  adAccountId: string,
): Promise<SyncVideosResult> {
  const account = await prisma.metaAdAccount.findUnique({
    where: { id: adAccountId },
    include: { business: { include: { connection: true } } },
  });

  if (!account) {
    throw new Error(`Ad account not found: ${adAccountId}`);
  }
  if (!account.selectedForSync) {
    throw new Error(`Ad account ${adAccountId} is not selected for sync`);
  }

  const syncLog = await prisma.syncLog.create({
    data: {
      adAccountId: account.id,
      kind: "videos",
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    // Pass 1: ad-account-library videos.
    const videos = await metaClient.listAdVideos(
      account.business.connection.id,
      account.metaAdAccountId,
    );

    let upserted = 0;
    for (const v of videos) {
      await upsertVideo(account.id, v);
      upserted++;
    }

    // Pass 2: backfill creative-referenced video ids that pass 1 missed.
    // We only do this AFTER creatives have been synced for this account at
    // least once — if AdCreative is empty there's nothing to backfill.
    const creativesWithVideo = await prisma.adCreative.findMany({
      where: { adAccountId: account.id, videoId: { not: null } },
      select: { videoId: true },
    });
    const referencedIds = Array.from(
      new Set(
        creativesWithVideo
          .map((c) => c.videoId)
          .filter((v): v is string => !!v),
      ),
    );
    if (referencedIds.length > 0) {
      const existing = await prisma.adVideo.findMany({
        where: {
          adAccountId: account.id,
          metaVideoId: { in: referencedIds },
        },
        select: { metaVideoId: true },
      });
      const have = new Set(existing.map((e) => e.metaVideoId));
      const missing = referencedIds.filter((id) => !have.has(id));

      // Sequential — N extra calls is fine, parallel would burst the
      // per-token rate limit on accounts with many Page-video ads.
      for (const vid of missing) {
        const v = await metaClient
          .getAdVideoById(account.business.connection.id, vid)
          .catch(() => null);
        if (!v) continue; // 404 / inaccessible — skip silently.
        await upsertVideo(account.id, v);
        upserted++;
      }
    }

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: "success", finishedAt: new Date() },
    });

    return { adAccountId: account.id, upserted, syncLogId: syncLog.id };
  } catch (err) {
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

async function upsertVideo(adAccountId: string, v: NormalizedAdVideo) {
  await prisma.adVideo.upsert({
    where: {
      adAccountId_metaVideoId: {
        adAccountId,
        metaVideoId: v.id,
      },
    },
    create: {
      adAccountId,
      metaVideoId: v.id,
      title: v.title,
      description: v.description,
      thumbnailUrl: v.thumbnailUrl,
      sourceUrl: v.sourceUrl,
      lengthSeconds: v.lengthSeconds,
      status: v.status,
      metaCreatedTime: v.createdTime,
      syncedAt: new Date(),
    },
    update: {
      title: v.title,
      description: v.description,
      thumbnailUrl: v.thumbnailUrl,
      sourceUrl: v.sourceUrl,
      lengthSeconds: v.lengthSeconds,
      status: v.status,
      metaCreatedTime: v.createdTime,
      syncedAt: new Date(),
    },
  });
}
