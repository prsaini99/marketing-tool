/**
 * Create a standalone ad creative on Meta + mirror it locally.
 *
 *   1. AuditLog row BEFORE the Meta call.
 *   2. POST /act_X/adcreatives with an object_story_spec.link_data creative.
 *   3. Mirror the new creative into AdCreative so it shows on the Creatives
 *      page + Edit Ad swap picker immediately.
 *
 * This is the image+link creative (the common case): a page-attributed post
 * with an image, primary text, headline, link, and CTA — the same shape the
 * inline create-ad flow builds, but standalone + reusable.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export interface CreateAdCreativeInput {
  metaAdAccountId: string;
  name?: string;
  pageId: string;
  imageHash: string;
  message: string; // primary text / body
  headline?: string; // link_data.name
  description?: string;
  linkUrl: string;
  callToActionType: string; // SHOP_NOW, LEARN_MORE, …
  instagramActorId?: string;
}

export interface CreateAdCreativeResult {
  metaCreativeId: string;
}

export async function createAdCreative(
  input: CreateAdCreativeInput,
): Promise<CreateAdCreativeResult> {
  if (!input.pageId?.trim()) throw new Error("A Facebook Page is required");
  if (!input.imageHash?.trim()) throw new Error("An image is required");
  if (!input.linkUrl?.trim()) throw new Error("A website URL is required");
  if (!input.callToActionType) throw new Error("A call-to-action is required");

  const account = await prisma.metaAdAccount.findFirst({
    where: {
      metaAdAccountId: input.metaAdAccountId.startsWith("act_")
        ? input.metaAdAccountId
        : `act_${input.metaAdAccountId}`,
      selectedForSync: true,
    },
    include: { business: { include: { connection: true } } },
  });
  if (!account) {
    throw new Error("Ad account not found or not selected for sync");
  }

  const link = input.linkUrl.trim();
  const linkData: Record<string, unknown> = {
    link,
    image_hash: input.imageHash.trim(),
    message: input.message?.trim() || undefined,
    name: input.headline?.trim() || undefined,
    description: input.description?.trim() || undefined,
    call_to_action: {
      type: input.callToActionType,
      value: { link },
    },
  };
  const objectStorySpec: Record<string, unknown> = {
    page_id: input.pageId.trim(),
    link_data: linkData,
  };
  if (input.instagramActorId?.trim()) {
    objectStorySpec.instagram_actor_id = input.instagramActorId.trim();
  }

  const name = input.name?.trim() || undefined;
  const intent = {
    name: name ?? null,
    pageId: input.pageId,
    imageHash: input.imageHash,
    headline: input.headline ?? null,
    callToActionType: input.callToActionType,
    linkUrl: link,
  };

  const auditRow = await prisma.auditLog.create({
    data: {
      action: "creative.create",
      targetType: "creative",
      targetId: "(pending)",
      before: {},
      after: { ...intent, _pending: true },
    },
  });

  let created: { id: string };
  try {
    created = await metaClient.createAdCreative(
      account.business.connection.id,
      account.metaAdAccountId,
      {
        name,
        object_story_spec: objectStorySpec,
      },
    );
  } catch (err) {
    const message =
      err instanceof MetaApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    await prisma.auditLog.update({
      where: { id: auditRow.id },
      data: { after: { ...intent, _failed: true, _error: message } },
    });
    throw err;
  }

  await prisma.adCreative.upsert({
    where: {
      adAccountId_metaCreativeId: {
        adAccountId: account.id,
        metaCreativeId: created.id,
      },
    },
    create: {
      adAccountId: account.id,
      metaCreativeId: created.id,
      name: name ?? null,
      body: input.message?.trim() || null,
      title: input.headline?.trim() || null,
      linkUrl: link,
      imageHash: input.imageHash.trim(),
      callToActionType: input.callToActionType,
      status: "ACTIVE",
      pageId: input.pageId.trim(),
      instagramActorId: input.instagramActorId?.trim() || null,
      objectType: "SHARE",
      syncedAt: new Date(),
    },
    update: {
      name: name ?? null,
      body: input.message?.trim() || null,
      title: input.headline?.trim() || null,
      linkUrl: link,
      imageHash: input.imageHash.trim(),
      callToActionType: input.callToActionType,
      syncedAt: new Date(),
    },
  });

  await prisma.auditLog.update({
    where: { id: auditRow.id },
    data: {
      targetId: created.id,
      after: { ...intent, metaCreativeId: created.id },
    },
  });

  return { metaCreativeId: created.id };
}
