/**
 * Starting and advancing a video generation. The only module that composes
 * the shot stage, the prompt builders and the Higgsfield client.
 *
 * Everything here is written around one fact: a Higgsfield render costs
 * money the moment it is queued. Every ordering decision below exists so
 * that a charge always leaves something recoverable behind.
 */

import type { VideoGeneration } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createVideo, getVideoJob } from "@/lib/higgsfield/client";
import { artDirectionFor } from "@/server/services/ai/art-directions";
import {
  aspectForPlacement,
  type VideoFormat,
} from "@/server/services/ai/video-formats";
import {
  buildNegativePrompt,
  buildVideoPrompt,
  type VideoBrand,
  type VideoToggles,
} from "@/server/services/ai/video-prompt";
import { writeVideoShot } from "@/server/services/ai/video-shot";
import type { BrandContext } from "@/server/services/ai/ad-copy";
import { assetPath, storeBytes } from "@/lib/storage/assets";

/**
 * Carries whether a failure was the vendor's or ours. A vendor message is the
 * only text that says what to fix, so it is forwarded to the browser verbatim
 * (the same reasoning as readMetaError); a Prisma error is our own plumbing
 * and gets a generic line plus a server log.
 */
export class VideoGenerationError extends Error {
  constructor(
    message: string,
    readonly kind: "vendor" | "internal",
  ) {
    super(message);
    this.name = "VideoGenerationError";
  }
}

export async function startVideoGeneration(args: {
  businessId: string | null;
  format: VideoFormat;
  brief: string;
  placementId: string;
  brand: VideoBrand | null;
  toggles: VideoToggles;
  context: BrandContext | null;
}): Promise<{ id: string; angle: string; note: string | null }> {
  const { businessId, format, brief, placementId, brand, toggles, context } = args;

  const { shot, angle } = await writeVideoShot({ format, brief, brand, context });
  const direction = artDirectionFor(format.look, Math.floor(Math.random() * 1000));
  const { aspectRatio, note } = aspectForPlacement(placementId);

  const prompt = buildVideoPrompt({
    brief,
    scene: format.scene,
    brand,
    toggles,
    artDirection: direction.direction,
    shot,
  });
  const negativePrompt = buildNegativePrompt(brand, toggles);

  // Row first, vendor second — the order src/server/services/campaigns/
  // bulk-status.ts uses for every Meta write, and for the same reason. A row
  // written before the charge can be wrong in a recoverable way (a QUEUED row
  // with a null requestId is visible, explainable and deletable); a charge
  // made before the row is not recoverable at all. The failure this closes is
  // real: a businessId that no longer exists raises a P2003 *after* the clip
  // is queued and billed, leaving no row, no requestId and no way back to it.
  let row: { id: string };
  try {
    row = await prisma.videoGeneration.create({
      data: {
        businessId,
        formatId: format.id,
        brief,
        prompt,
        negativePrompt,
        aspectRatio,
        durationSeconds: 5,
        requestId: null,
        status: "QUEUED",
      },
      select: { id: true },
    });
  } catch (err) {
    // Nothing was sent to the vendor, so nothing was charged.
    console.error("ad-video: could not write the generation row", err);
    throw new VideoGenerationError(
      "Couldn't record this generation, so nothing was sent for rendering.",
      "internal",
    );
  }

  let job;
  try {
    job = await createVideo({
      prompt,
      negativePrompt,
      aspectRatio,
      durationSeconds: 5,
    });
  } catch (err) {
    // A create failure is not proof nothing was queued — a timeout can land
    // after the vendor accepted the job. The row therefore stays, marked
    // FAILED with the vendor's own words, rather than being deleted: an
    // attempt on the record is worth more than a tidy table.
    const message =
      err instanceof Error ? err.message : "Video generation failed";
    await prisma.videoGeneration
      .update({
        where: { id: row.id },
        data: { status: "FAILED", error: message },
      })
      .catch((e) => console.error("ad-video: could not mark the row failed", e));
    throw new VideoGenerationError(message, "vendor");
  }

  // createVideo refuses to return an empty requestId, so this always stamps a
  // real one. If the stamp itself fails the clip is already queued and paid
  // for, so the row is kept and reported rather than deleted.
  try {
    await prisma.videoGeneration.update({
      where: { id: row.id },
      data: { requestId: job.requestId, status: job.status },
    });
  } catch (err) {
    // The request id goes in the log deliberately: the clip is queued and
    // charged, the row will later be marked FAILED for having no id, and
    // this line is then the only surviving handle that can still fetch it.
    console.error(
      `ad-video: could not stamp the request id ${job.requestId} onto ${row.id}`,
      err,
    );
    throw new VideoGenerationError(
      "The video was queued but couldn't be linked to its record. Check Recent generations before trying again — it may still arrive.",
      "internal",
    );
  }

  return { id: row.id, angle, note };
}

/** Poll ceiling: a job still running at the vendor after this is given up on. */
const MAX_JOB_AGE_MS = 10 * 60 * 1000;

/**
 * Roughly how long a Higgsfield result URL stays alive. Past this there is
 * nothing left to fetch, so retrying is pure noise.
 */
const VENDOR_URL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long before a failed copy is worth attempting again. Long enough that a
 * page reload, a mode switch or a stray poll cannot turn into a stream of
 * full-clip downloads; short enough that a Supabase blip costs one coffee's
 * wait rather than the clip.
 */
const STORE_RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * Whether a READY row is worth trying to store again — the same shape as
 * needsCapture in sync/capture-assets.ts, and for the same reason: storedAt
 * and storeAttemptedAt are a pair, and it is the attempt stamp that keeps a
 * retry from re-downloading the file on every single advance.
 */
export function needsStoreRetry(row: {
  storagePath: string | null;
  vendorUrl: string | null;
  storeAttemptedAt: Date | null;
  createdAt: Date;
}): boolean {
  if (row.storagePath) return false;
  if (!row.vendorUrl) return false;
  if (Date.now() - row.createdAt.getTime() > VENDOR_URL_LIFETIME_MS) return false;
  if (!row.storeAttemptedAt) return true;
  return Date.now() - row.storeAttemptedAt.getTime() > STORE_RETRY_AFTER_MS;
}

/**
 * Copies a finished clip out of Higgsfield, who delete results after about
 * seven days. Best-effort: returns null on any failure, including the case
 * where SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset and storeBytes
 * can do nothing at all. A failure here is not terminal — the vendor URL is
 * kept on the row and a later poll retries this, bounded by needsStoreRetry.
 */
async function copyToStorage(
  row: { id: string; businessId: string | null },
  vendorUrl: string,
): Promise<string | null> {
  try {
    const res = await fetch(vendorUrl);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const path = assetPath("videos", row.businessId ?? "_workspace", row.id);
    const stored = await storeBytes(path, bytes, "video/mp4");
    return stored.ok ? path : null;
  } catch (err) {
    console.error("ad-video: storing the clip failed", err);
    return null;
  }
}

/**
 * Advances one job: asks the vendor, and on completion copies the file into
 * our own bucket.
 *
 * `scope` is the businessId the caller is allowed to see — null being the
 * workspace's own, exactly as BrandKit scopes. It is part of the lookup, not
 * a check afterwards, so this can never read or mutate another client's row.
 */
export async function advanceVideoGeneration(
  id: string,
  scope: string | null,
): Promise<VideoGeneration | null> {
  const row = await prisma.videoGeneration.findFirst({
    where: { id, businessId: scope },
  });
  if (!row) return null;

  if (row.status === "FAILED" || row.status === "CANCELLED") return row;

  // READY *with* a file is the only genuinely finished state. READY without
  // one is a paid clip we failed to copy, so it stays advanceable: a later
  // poll retries the copy from the vendor URL instead of the operator being
  // told to pay again.
  if (row.status === "READY") {
    // The vendorUrl check is redundant with needsStoreRetry and kept for the
    // type narrowing, which is cheaper than a non-null assertion.
    if (!needsStoreRetry(row) || !row.vendorUrl) return row;
    const storagePath = await copyToStorage(row, row.vendorUrl);
    const now = new Date();
    // The attempt is recorded whether or not it worked. Without that stamp
    // every mount, and every Still/Video toggle, re-downloads every unstored
    // clip in the list at once.
    return prisma.videoGeneration.update({
      where: { id: row.id },
      data: {
        storagePath: storagePath ?? undefined,
        storedAt: storagePath ? now : undefined,
        storeAttemptedAt: now,
      },
    });
  }

  const stale = Date.now() - row.createdAt.getTime() > MAX_JOB_AGE_MS;

  // The age check sits ABOVE the requestId guard on purpose. A row with no
  // requestId can never be polled, so if the guard came first such a row
  // would stay QUEUED forever and the client would poll it every five
  // seconds for the life of the account.
  if (!row.requestId) {
    if (!stale) return row;
    return prisma.videoGeneration.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        error: "The render was never linked to a request id, so it can't be tracked.",
      },
    });
  }

  let job;
  try {
    job = await getVideoJob(row.requestId);
  } catch (err) {
    // A network blip between us and Higgsfield is not evidence the render
    // failed — writing FAILED here would discard a job that's still
    // running and already paid for. Leave the row untouched; the next
    // poll tries again.
    console.error("ad-video advance: getVideoJob failed", err);
    return row;
  }

  if (job.status !== "READY") {
    const terminal = job.status === "FAILED" || job.status === "CANCELLED";
    // The ceiling is applied only after asking, and only if the vendor still
    // says the job is going. Applied before the poll it discarded finished
    // work: close the tab for eleven minutes on a perfectly good render and
    // the next load wrote FAILED without ever looking at the file.
    if (!terminal && stale) {
      return prisma.videoGeneration.update({
        where: { id: row.id },
        data: { status: "FAILED", error: "Timed out waiting for the video." },
      });
    }
    return prisma.videoGeneration.update({
      where: { id: row.id },
      // job.error is null for non-terminal statuses by construction (see
      // normalise), so an in-progress payload's chatter is never stored.
      data: { status: job.status, error: job.error },
    });
  }

  const vendorUrl = job.videoUrl ?? row.vendorUrl;
  const storagePath = vendorUrl ? await copyToStorage(row, vendorUrl) : null;
  const now = new Date();

  // vendorUrl is persisted whether or not the copy worked. If it worked it is
  // simply provenance; if it didn't, it is the only remaining route to a clip
  // that has already been paid for — for about seven days, which is also long
  // enough for a later poll to retry the copy.
  return prisma.videoGeneration.update({
    where: { id: row.id },
    data: {
      status: "READY",
      vendorUrl,
      storagePath,
      storedAt: storagePath ? now : null,
      // Stamped even when there was nothing to fetch, so the retry window
      // starts here rather than on the next advance.
      storeAttemptedAt: now,
      error: null,
    },
  });
}

/**
 * The row as the client may see it. `prompt` and `negativePrompt` are stored
 * so a result can be explained later, not so the browser can read them.
 *
 * A stored file is served through /api/media, which inherits the session
 * check middleware applies to /api/* — the vendor URL is only offered when
 * storing failed, and `expiresSoon` flags it because it dies in about seven
 * days. Offering it is the point: the alternative is telling the operator to
 * pay for the same clip twice.
 */
export function toPublic(row: {
  id: string;
  status: string;
  error: string | null;
  vendorUrl: string | null;
  storagePath: string | null;
  aspectRatio: string;
  formatId: string;
  createdAt: Date;
}) {
  const stored = row.storagePath ? `/api/media/${row.storagePath}` : null;
  const fallback = row.status === "READY" ? row.vendorUrl : null;
  return {
    id: row.id,
    status: row.status,
    error: row.error,
    videoUrl: stored ?? fallback,
    expiresSoon: stored === null && fallback !== null,
    aspectRatio: row.aspectRatio,
    formatId: row.formatId,
    createdAt: row.createdAt.toISOString(),
  };
}
