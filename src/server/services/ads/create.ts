/**
 * Create a new ad on Meta + mirror locally.
 *
 * Two creative shapes share one flow:
 *   • Image — upload the bytes → get an `image_hash` → object_story_spec.link_data.
 *   • Video — reference a library video by `video_id` → object_story_spec.video_data.
 *     Meta requires a poster for video creatives, so we pass the library
 *     thumbnail as `image_url`. (Videos are uploaded to the account library
 *     separately, then picked here once Meta finishes processing them — a
 *     just-uploaded video can't be used until it's `ready` and has a poster.)
 *
 * AuditLog lifecycle in both cases:
 *   1. AuditLog row written BEFORE any Meta call (captures intent).
 *   2. (Image only) upload bytes — failure stamps audit row + bails out.
 *   3. Create ad — failure stamps audit row + bails out.
 *   4. Insert local Ad row on success.
 *   5. Stamp audit row with the new ad id.
 *
 * Source identity is always a Facebook Page. Carousel / collection /
 * existing-creative paths remain a follow-up.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

interface CreateAdBase {
  // Parent ad set's Meta id. Service resolves account + campaign from it.
  metaAdSetId: string;
  name: string;
  status: "PAUSED" | "ACTIVE";

  pageId: string;
  instagramActorId?: string; // optional — for Instagram identity override
  link: string; // destination URL
  message: string; // primary text
  headline: string; // `name` / `title` on Meta's side
  description?: string; // small text under headline
  callToAction: string; // e.g. "SHOP_NOW"
}

export interface CreateImageAdInput extends CreateAdBase {
  mediaType: "image";
  // Provide EITHER uploaded bytes (we upload → hash) OR an existing library
  // image's hash (skip the upload — the bytes are already on Meta).
  imageBlob?: Blob;
  imageFilename?: string;
  imageHash?: string;
  // Optional poster URL for a library image — stored as the ad's table
  // thumbnail so it shows immediately. Uploaded images have no URL yet.
  imageUrl?: string;
}

export interface CreateVideoAdInput extends CreateAdBase {
  mediaType: "video";
  // A video already in the account's library (status `ready`).
  videoId: string;
  // Poster URL — Meta rejects a video creative with no thumbnail.
  thumbnailUrl: string;
}

export type CreateAdInput = CreateImageAdInput | CreateVideoAdInput;

export interface CreateAdResult {
  metaAdId: string;
  adId: string;
  imageHash?: string;
  videoId?: string;
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

  if (input.mediaType === "video") {
    if (!input.videoId.trim()) throw new Error("videoId is required");
    if (!input.thumbnailUrl.trim()) {
      throw new Error(
        "thumbnailUrl is required — Meta rejects a video creative with no poster",
      );
    }
  } else if (!input.imageHash?.trim() && !input.imageBlob) {
    throw new Error(
      "an image is required — provide either uploaded bytes or a library imageHash",
    );
  }

  const intent = {
    name,
    adSetMetaId: adSet.metaAdSetId,
    status: input.status,
    mediaType: input.mediaType,
    pageId: input.pageId,
    instagramActorId: input.instagramActorId ?? null,
    link: input.link,
    message: input.message,
    headline: input.headline,
    description: input.description ?? null,
    callToAction: input.callToAction,
    ...(input.mediaType === "image"
      ? {
          imageSource: input.imageHash?.trim() ? "library" : "upload",
          imageFilename: input.imageFilename ?? null,
          imageHash: input.imageHash?.trim() ?? null,
        }
      : { videoId: input.videoId }),
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

  // 2. (Image only) resolve the hash. A library image already has one, so we
  //    skip the upload; otherwise we upload the bytes to get it. Video ads
  //    reference a library video by id, so there's nothing to upload.
  let imageHash: string | undefined;
  if (input.mediaType === "image" && input.imageHash?.trim()) {
    imageHash = input.imageHash.trim();
  } else if (input.mediaType === "image" && input.imageBlob) {
    try {
      const upload = await metaClient.uploadAdImage(
        connectionId,
        metaAdAccountId,
        input.imageBlob,
        input.imageFilename ?? "upload.jpg",
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
  }

  // 3. Build creative (link_data for image, video_data for video) + POST.
  const callToAction = {
    type: input.callToAction,
    value: { link: input.link.trim() },
  };
  const objectStorySpec: Record<string, unknown> = {
    page_id: input.pageId.trim(),
  };
  if (input.mediaType === "image") {
    const linkData: Record<string, unknown> = {
      link: input.link.trim(),
      message: input.message.trim(),
      name: input.headline.trim(),
      image_hash: imageHash,
      call_to_action: callToAction,
    };
    if (input.description?.trim()) {
      linkData.description = input.description.trim();
    }
    objectStorySpec.link_data = linkData;
  } else {
    const videoData: Record<string, unknown> = {
      video_id: input.videoId.trim(),
      title: input.headline.trim(),
      message: input.message.trim(),
      image_url: input.thumbnailUrl.trim(),
      call_to_action: callToAction,
    };
    if (input.description?.trim()) {
      videoData.link_description = input.description.trim();
    }
    objectStorySpec.video_data = videoData;
  }
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

  // 4. Local insert. Set format explicitly per media type. Stash a poster as
  //    creativeThumbnailUrl when we have one (video poster, or a library
  //    image's URL) so the ads table shows it immediately — a later sync
  //    backfills the real creative id + thumbnail.
  const thumbnailUrl =
    input.mediaType === "video"
      ? input.thumbnailUrl.trim()
      : (input.imageUrl?.trim() ?? null);
  const ad = await prisma.ad.create({
    data: {
      metaAdId: createResult.id,
      adAccountId: adSet.adAccountId,
      adSetId: adSet.id,
      name,
      status: input.status,
      format: input.mediaType === "image" ? "SINGLE_IMAGE" : "VIDEO",
      creativeThumbnailUrl: thumbnailUrl,
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
    videoId: input.mediaType === "video" ? input.videoId.trim() : undefined,
  };
}
