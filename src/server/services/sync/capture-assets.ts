/**
 * Capture creative asset bytes into durable storage.
 *
 * Runs at the end of the image, video and creative syncs, which is the one
 * moment the URL Meta handed over is guaranteed live. See
 * src/lib/storage/assets.ts for why that window is so narrow.
 *
 * CONTRACT: this never throws and never fails its caller. A sync that dies
 * because one thumbnail 404'd would be a far worse bug than a missing
 * thumbnail. Every outcome is written to the row so the next run knows what
 * to retry, and the summary is returned for the sync log.
 *
 * Sequential, not Promise.all. These are downloads from Meta's CDN followed
 * by uploads to Supabase, and firing forty at once is how you get rate
 * limited by one and throttled by the other. The whole point is that this
 * runs once per asset ever, so it can afford to be slow.
 */

import { prisma } from "@/lib/db/prisma";
import {
  assetPath,
  storageConfigured,
  storeFromUrl,
  type AssetKind,
} from "@/lib/storage/assets";

export interface CaptureSummary {
  attempted: number;
  stored: number;
  skipped: number;
  failed: number;
  /** First few failures, for the sync log. Not every error, just a taste. */
  errors: string[];
}

const EMPTY: CaptureSummary = {
  attempted: 0,
  stored: 0,
  skipped: 0,
  failed: 0,
  errors: [],
};

/**
 * How long before a previously failed capture is worth retrying.
 *
 * A retired CDN hostname never comes back, but the NEXT sync mints a fresh
 * URL on a different shard, so the retry is worth making once new URLs
 * exist. Waiting an hour stops a manual re-sync loop from hammering dead
 * hostnames for nothing.
 */
const RETRY_AFTER_MS = 60 * 60 * 1000;

/** Rows that still need bytes: never stored, and not attempted recently. */
function needsCapture(row: {
  storagePath: string | null;
  storeAttemptedAt: Date | null;
}): boolean {
  if (row.storagePath) return false;
  if (!row.storeAttemptedAt) return true;
  return Date.now() - row.storeAttemptedAt.getTime() > RETRY_AFTER_MS;
}

/** Cap per run so one sync cannot spend forever on a huge backlog. */
const MAX_PER_RUN = 60;

export async function captureImagesForAccount(
  adAccountId: string,
  metaAdAccountId: string,
): Promise<CaptureSummary> {
  if (!storageConfigured()) return EMPTY;
  const rows = await prisma.adImage.findMany({
    where: { adAccountId, url: { not: null } },
    select: {
      id: true,
      metaImageHash: true,
      url: true,
      storagePath: true,
      storeAttemptedAt: true,
    },
  });
  return run(
    rows.filter(needsCapture).slice(0, MAX_PER_RUN),
    "images",
    metaAdAccountId,
    (r) => r.metaImageHash,
    (r) => r.url!,
    (id, data) => prisma.adImage.update({ where: { id }, data }),
  );
}

export async function captureVideosForAccount(
  adAccountId: string,
  metaAdAccountId: string,
): Promise<CaptureSummary> {
  if (!storageConfigured()) return EMPTY;
  const rows = await prisma.adVideo.findMany({
    where: { adAccountId, thumbnailUrl: { not: null } },
    select: {
      id: true,
      metaVideoId: true,
      thumbnailUrl: true,
      storagePath: true,
      storeAttemptedAt: true,
    },
  });
  // The poster, not the mp4. Posters are what the galleries render, they are
  // small, and Meta's source mp4 URL is frequently absent anyway (a
  // Page-owned reel has no downloadable file). Storing multi-megabyte video
  // on every sync to fix a broken thumbnail would be the wrong trade.
  return run(
    rows.filter(needsCapture).slice(0, MAX_PER_RUN),
    "videos",
    metaAdAccountId,
    (r) => `${r.metaVideoId}-poster`,
    (r) => r.thumbnailUrl!,
    (id, data) => prisma.adVideo.update({ where: { id }, data }),
  );
}

export async function captureCreativesForAccount(
  adAccountId: string,
  metaAdAccountId: string,
): Promise<CaptureSummary> {
  if (!storageConfigured()) return EMPTY;
  const rows = await prisma.adCreative.findMany({
    where: { adAccountId, thumbnailUrl: { not: null } },
    select: {
      id: true,
      metaCreativeId: true,
      thumbnailUrl: true,
      storagePath: true,
      storeAttemptedAt: true,
    },
  });
  return run(
    rows.filter(needsCapture).slice(0, MAX_PER_RUN),
    "creatives",
    metaAdAccountId,
    (r) => r.metaCreativeId,
    (r) => r.thumbnailUrl!,
    (id, data) => prisma.adCreative.update({ where: { id }, data }),
  );
}

async function run<T extends { id: string }>(
  rows: T[],
  kind: AssetKind,
  metaAdAccountId: string,
  keyOf: (row: T) => string,
  urlOf: (row: T) => string,
  update: (
    id: string,
    data: {
      storagePath?: string | null;
      storedAt?: Date | null;
      storeAttemptedAt: Date;
      storeError?: string | null;
    },
  ) => Promise<unknown>,
): Promise<CaptureSummary> {
  const summary: CaptureSummary = { ...EMPTY, errors: [] };

  for (const row of rows) {
    summary.attempted++;
    const path = assetPath(kind, metaAdAccountId, keyOf(row));
    const res = await storeFromUrl(urlOf(row), path, { skipIfPresent: true });
    const now = new Date();

    try {
      if (res.ok) {
        // bytes === 0 means it was already in the bucket and we skipped the
        // download. Still a success, still worth recording the path.
        if (res.bytes === 0) summary.skipped++;
        else summary.stored++;
        await update(row.id, {
          storagePath: res.path,
          storedAt: now,
          storeAttemptedAt: now,
          storeError: null,
        });
      } else {
        summary.failed++;
        if (summary.errors.length < 3 && res.error) summary.errors.push(res.error);
        // Record the attempt WITHOUT a path, so needsCapture retries it once
        // the next sync has minted fresh URLs.
        await update(row.id, {
          storeAttemptedAt: now,
          storeError: res.error?.slice(0, 300) ?? "unknown",
        });
      }
    } catch {
      // A database write failing here must not take down the sync either.
      summary.failed++;
    }
  }

  return summary;
}
