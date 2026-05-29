/**
 * Resumable ad-video upload helpers (server side).
 *
 * The browser drives the 3-phase loop (start → transfer chunks → finish),
 * but each phase routes through us so the Meta token never reaches the
 * client. This module:
 *   • resolves account → connection for each phase
 *   • on finish, audit-logs `video.upload` and mirrors a local AdVideo row
 *     (status PROCESSING — Meta finishes encoding async; a later sync fills
 *     in duration/thumbnail).
 *
 * Transfer chunks are forwarded straight through in the route (no DB), so
 * there's no helper here for them.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient } from "@/lib/meta/client";

interface ResolvedAccount {
  localId: string;
  metaAdAccountId: string;
  connectionId: string;
}

/** Shared resolver — every phase needs the connection for the Meta call. */
export async function resolveUploadAccount(
  metaAdAccountIdParam: string,
): Promise<ResolvedAccount> {
  const metaAdAccountId = metaAdAccountIdParam.startsWith("act_")
    ? metaAdAccountIdParam
    : `act_${metaAdAccountIdParam}`;
  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId, selectedForSync: true },
    select: {
      id: true,
      metaAdAccountId: true,
      business: { select: { connectionId: true } },
    },
  });
  if (!account) {
    throw new Error("Ad account not found or not selected for sync");
  }
  return {
    localId: account.id,
    metaAdAccountId: account.metaAdAccountId,
    connectionId: account.business.connectionId,
  };
}

export async function startVideoUpload(
  metaAdAccountIdParam: string,
  fileSize: number,
) {
  const account = await resolveUploadAccount(metaAdAccountIdParam);
  return metaClient.startVideoUpload(
    account.connectionId,
    account.metaAdAccountId,
    fileSize,
  );
}

export async function transferVideoChunk(
  metaAdAccountIdParam: string,
  uploadSessionId: string,
  startOffset: number,
  chunk: Blob,
) {
  const account = await resolveUploadAccount(metaAdAccountIdParam);
  return metaClient.transferVideoChunk(
    account.connectionId,
    account.metaAdAccountId,
    uploadSessionId,
    startOffset,
    chunk,
  );
}

export interface FinishVideoUploadInput {
  metaAdAccountId: string;
  uploadSessionId: string;
  videoId: string;
  title?: string;
  description?: string;
}

export async function finishVideoUpload(input: FinishVideoUploadInput) {
  const account = await resolveUploadAccount(input.metaAdAccountId);

  const auditRow = await prisma.auditLog.create({
    data: {
      action: "video.upload",
      targetType: "video",
      targetId: input.videoId,
      before: {},
      after: {
        videoId: input.videoId,
        title: input.title ?? null,
        _pending: true,
      },
    },
  });

  try {
    await metaClient.finishVideoUpload(
      account.connectionId,
      account.metaAdAccountId,
      input.uploadSessionId,
      { title: input.title, description: input.description },
    );
  } catch (err) {
    await prisma.auditLog.update({
      where: { id: auditRow.id },
      data: {
        after: {
          videoId: input.videoId,
          _failed: true,
          _error: err instanceof Error ? err.message : "Unknown error",
        },
      },
    });
    throw err;
  }

  // Mirror locally so it shows on the Video library immediately. Meta is
  // still encoding (status PROCESSING) — a later videos sync backfills
  // duration / thumbnail / ready status.
  await prisma.adVideo.upsert({
    where: {
      adAccountId_metaVideoId: {
        adAccountId: account.localId,
        metaVideoId: input.videoId,
      },
    },
    create: {
      adAccountId: account.localId,
      metaVideoId: input.videoId,
      title: input.title || null,
      description: input.description || null,
      status: "processing",
      metaCreatedTime: new Date(),
      syncedAt: new Date(),
    },
    update: {
      title: input.title || null,
      description: input.description || null,
      syncedAt: new Date(),
    },
  });

  await prisma.auditLog.update({
    where: { id: auditRow.id },
    data: { after: { videoId: input.videoId, title: input.title ?? null } },
  });

  return { videoId: input.videoId };
}
