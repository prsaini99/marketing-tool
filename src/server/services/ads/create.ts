/**
 * Create a new ad on Meta + mirror locally.
 *
 * Two-step Meta flow:
 *   1. Upload the image bytes → get an `image_hash`.
 *   2. POST to /act_{id}/ads with a creative built around that hash.
 *
 * We wrap both in a single AuditLog lifecycle:
 *   1. AuditLog row written BEFORE either Meta call (captures intent).
 *   2. Upload image — failure stamps audit row + bails out.
 *   3. Create ad — failure stamps audit row + bails out.
 *   4. Insert local Ad row on success.
 *   5. Stamp audit row with the new ad id.
 *
 * Scope: single-image link ad with Facebook Page as the source identity.
 * Carousel / video / collection / existing-creative paths are a follow-up.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export interface CreateAdInput {
  // Parent ad set's Meta id. Service resolves account + campaign from it.
  metaAdSetId: string;
  name: string;
  status: "PAUSED" | "ACTIVE";

  // Creative — single-image link ad.
  pageId: string;
  instagramActorId?: string; // optional — for Instagram identity override
  link: string; // destination URL
  message: string; // primary text
  headline: string; // `name` on Meta's side
  description?: string; // small text under headline
  callToAction: string; // e.g. "SHOP_NOW"

  // Image bytes — we upload first, then reference the returned hash.
  imageBlob: Blob;
  imageFilename: string;
}

export interface CreateAdResult {
  metaAdId: string;
  adId: string;
  imageHash: string;
}

export async function createAd(
  input: CreateAdInput,
): Promise<CreateAdResult> {
  const name = input.name?.trim();
  if (!name) throw new Error("name is required");
  if (input.status !== "PAUSED" && input.status !== "ACTIVE") {
    throw new Error("status must be 'PAUSED' or 'ACTIVE'");
  }
  if (!input.pageId.trim()) throw new Error("pageId is required");
  if (!input.link.trim()) throw new Error("link is required");
  if (!input.message.trim()) throw new Error("message (primary text) is required");
  if (!input.headline.trim()) throw new Error("headline is required");
  if (!input.callToAction) throw new Error("callToAction is required");

  // Resolve parent ad set → ad account → connection. AdSet must be in a
  // selected-for-sync account, otherwise the connection might be revoked.
  const adSet = await prisma.adSet.findFirst({
    where: {
      metaAdSetId: input.metaAdSetId,
      adAccount: { selectedForSync: true },
    },
    include: {
      adAccount: {
        include: { business: { include: { connection: true } } },
      },
    },
  });
  if (!adSet) {
    throw new Error(
      "Parent ad set not found in any selected-for-sync account",
    );
  }

  const intent = {
    name,
    adSetMetaId: adSet.metaAdSetId,
    status: input.status,
    pageId: input.pageId,
    instagramActorId: input.instagramActorId ?? null,
    link: input.link,
    message: input.message,
    headline: input.headline,
    description: input.description ?? null,
    callToAction: input.callToAction,
    imageFilename: input.imageFilename,
  };

  // 1. AuditLog BEFORE any Meta call.
  const auditRow = await prisma.auditLog.create({
    data: {
      action: "ad.create",
      targetType: "ad",
      targetId: "(pending)",
      before: {},
      after: { ...intent, _pending: true } as unknown as Prisma.InputJsonValue,
    },
  });

  const connectionId = adSet.adAccount.business.connection.id;
  const metaAdAccountId = adSet.adAccount.metaAdAccountId;

  // 2. Upload image — get the hash to embed in the creative.
  let imageHash: string;
  try {
    const upload = await metaClient.uploadAdImage(
      connectionId,
      metaAdAccountId,
      input.imageBlob,
      input.imageFilename,
    );
    imageHash = upload.hash;
  } catch (err) {
    const message =
      err instanceof MetaApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Image upload failed";
    await prisma.auditLog.update({
      where: { id: auditRow.id },
      data: {
        after: {
          ...intent,
          _failed: true,
          _failedStep: "image_upload",
          _error: message,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    throw err;
  }

  // 3. Build creative + POST to Meta.
  const linkData: Record<string, unknown> = {
    link: input.link.trim(),
    message: input.message.trim(),
    name: input.headline.trim(),
    image_hash: imageHash,
    call_to_action: {
      type: input.callToAction,
      value: { link: input.link.trim() },
    },
  };
  if (input.description?.trim()) {
    linkData.description = input.description.trim();
  }
  const objectStorySpec: Record<string, unknown> = {
    page_id: input.pageId.trim(),
    link_data: linkData,
  };
  if (input.instagramActorId?.trim()) {
    objectStorySpec.instagram_actor_id = input.instagramActorId.trim();
  }

  const payload: Record<string, unknown> = {
    name,
    adset_id: adSet.metaAdSetId,
    status: input.status,
    creative: { object_story_spec: objectStorySpec },
  };

  let createResult: { id: string };
  try {
    createResult = await metaClient.createAd(
      connectionId,
      metaAdAccountId,
      payload,
    );
  } catch (err) {
    const message =
      err instanceof MetaApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Ad create failed";
    await prisma.auditLog.update({
      where: { id: auditRow.id },
      data: {
        after: {
          ...intent,
          imageHash,
          _failed: true,
          _failedStep: "ad_create",
          _error: message,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    throw err;
  }

  // 4. Local insert. Creative-format detection is deferred; we set format
  //    explicitly since we only support SINGLE_IMAGE for now.
  const ad = await prisma.ad.create({
    data: {
      metaAdId: createResult.id,
      adAccountId: adSet.adAccountId,
      adSetId: adSet.id,
      name,
      status: input.status,
      format: "SINGLE_IMAGE",
      metaUpdatedTime: new Date(),
    },
  });

  // 5. Stamp audit row.
  await prisma.auditLog.update({
    where: { id: auditRow.id },
    data: {
      targetId: createResult.id,
      after: {
        ...intent,
        imageHash,
        metaAdId: createResult.id,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    metaAdId: createResult.id,
    adId: ad.id,
    imageHash,
  };
}
