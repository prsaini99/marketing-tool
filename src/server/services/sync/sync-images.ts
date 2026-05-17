/**
 * Pulls raw images from one ad account's library and upserts them into our
 * AdImage table. Two passes:
 *
 *   1. GET /act_X/adimages — images uploaded directly to the ad account.
 *   2. For every image_hash referenced by an AdCreative in this account
 *      that isn't yet in AdImage, re-query /act_X/adimages with the hash
 *      filter — same endpoint but Meta lets you ask for a single hash.
 *      This catches images Meta omitted from the bulk list (deleted from
 *      library, Page-uploaded, …).
 *
 * Both passes upsert by (adAccountId, metaImageHash). SyncLog kind =
 * "images" for both — one logical sync.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient } from "@/lib/meta/client";
import type { NormalizedAdImage } from "@/lib/meta/types";

export interface SyncImagesResult {
  adAccountId: string;
  upserted: number;
  syncLogId: string;
}

export async function syncImagesForAccount(
  adAccountId: string,
): Promise<SyncImagesResult> {
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
      kind: "images",
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    // Pass 1: account-library images.
    const images = await metaClient.listAdImages(
      account.business.connection.id,
      account.metaAdAccountId,
    );

    let upserted = 0;
    for (const img of images) {
      await upsertImage(account.id, img);
      upserted++;
    }

    // Pass 2: backfill creative-referenced hashes that pass 1 missed.
    const creativesWithImage = await prisma.adCreative.findMany({
      where: { adAccountId: account.id, imageHash: { not: null } },
      select: { imageHash: true },
    });
    const referencedHashes = Array.from(
      new Set(
        creativesWithImage
          .map((c) => c.imageHash)
          .filter((v): v is string => !!v),
      ),
    );
    if (referencedHashes.length > 0) {
      const existing = await prisma.adImage.findMany({
        where: {
          adAccountId: account.id,
          metaImageHash: { in: referencedHashes },
        },
        select: { metaImageHash: true },
      });
      const have = new Set(existing.map((e) => e.metaImageHash));
      const missing = referencedHashes.filter((h) => !have.has(h));

      for (const hash of missing) {
        const img = await metaClient
          .getAdImageByHash(
            account.business.connection.id,
            account.metaAdAccountId,
            hash,
          )
          .catch(() => null);
        if (!img) continue;
        await upsertImage(account.id, img);
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

async function upsertImage(adAccountId: string, img: NormalizedAdImage) {
  await prisma.adImage.upsert({
    where: {
      adAccountId_metaImageHash: {
        adAccountId,
        metaImageHash: img.hash,
      },
    },
    create: {
      adAccountId,
      metaImageHash: img.hash,
      url: img.url,
      name: img.name,
      width: img.width,
      height: img.height,
      status: img.status,
      metaCreatedTime: img.createdTime,
      syncedAt: new Date(),
    },
    update: {
      url: img.url,
      name: img.name,
      width: img.width,
      height: img.height,
      status: img.status,
      metaCreatedTime: img.createdTime,
      syncedAt: new Date(),
    },
  });
}
