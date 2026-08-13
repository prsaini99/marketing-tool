/**
 * Upload a standalone image into an ad account's library.
 *
 * Counterpart to the video upload, but far simpler: images aren't chunked and
 * Meta returns the `hash` immediately (no async encoding), so one POST to
 * /act_{id}/adimages is the whole flow. We:
 *   1. AuditLog `image.upload` BEFORE the Meta call (captures intent),
 *   2. upload the bytes → hash (+ short-lived url),
 *   3. mirror an AdImage row locally so it shows on the Image library at once,
 *   4. stamp the audit row.
 *
 * A later images sync backfills width/height/status from Meta.
 */

import { prisma } from "@/lib/db/prisma";
import { assetPath, storeFromUrl } from "@/lib/storage/assets";
import { metaClient } from "@/lib/meta/client";

interface ResolvedAccount {
  localId: string;
  metaAdAccountId: string;
  connectionId: string;
}

async function resolveAccount(
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

export interface UploadLibraryImageInput {
  metaAdAccountId: string;
  imageBlob: Blob;
  imageFilename: string;
}

export interface UploadLibraryImageResult {
  hash: string;
  url: string | null;
}

export async function uploadLibraryImage(
  input: UploadLibraryImageInput,
): Promise<UploadLibraryImageResult> {
  const account = await resolveAccount(input.metaAdAccountId);

  const auditRow = await prisma.auditLog.create({
    data: {
      action: "image.upload",
      targetType: "image",
      targetId: "(pending)",
      before: {},
      after: { filename: input.imageFilename, _pending: true },
    },
  });

  let hash: string;
  let url: string | null;
  try {
    const upload = await metaClient.uploadAdImage(
      account.connectionId,
      account.metaAdAccountId,
      input.imageBlob,
      input.imageFilename,
    );
    hash = upload.hash;
    url = upload.url ?? null;
  } catch (err) {
    await prisma.auditLog.update({
      where: { id: auditRow.id },
      data: {
        after: {
          filename: input.imageFilename,
          _failed: true,
          _error: err instanceof Error ? err.message : "Upload failed",
        },
      },
    });
    throw err;
  }

  // Mirror locally so it shows on the Image library immediately. A later
  // images sync backfills width/height/status.
  await prisma.adImage.upsert({
    where: {
      adAccountId_metaImageHash: {
        adAccountId: account.localId,
        metaImageHash: hash,
      },
    },
    create: {
      adAccountId: account.localId,
      metaImageHash: hash,
      url,
      name: input.imageFilename,
      status: "ACTIVE",
      metaCreatedTime: new Date(),
      syncedAt: new Date(),
    },
    update: {
      url: url ?? undefined,
      name: input.imageFilename,
      syncedAt: new Date(),
    },
  });

  // Capture the bytes now. An uploaded asset never passes through the
  // images sync, which is where capture normally hooks in, so without this
  // it would sit with a null storagePath until the next full sync happened
  // to pick it up. And the URL Meta just handed back is as fresh as it will
  // ever be.
  if (url) {
    const path = assetPath("images", account.metaAdAccountId, hash);
    const stored = await storeFromUrl(url, path, { skipIfPresent: true });
    if (stored.ok) {
      await prisma.adImage.update({
        where: {
          adAccountId_metaImageHash: {
            adAccountId: account.localId,
            metaImageHash: hash,
          },
        },
        data: { storagePath: stored.path, storedAt: new Date(), storeAttemptedAt: new Date() },
      });
    }
  }

  await prisma.auditLog.update({
    where: { id: auditRow.id },
    data: {
      targetId: hash,
      after: { filename: input.imageFilename, hash },
    },
  });

  return { hash, url };
}
