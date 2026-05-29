/**
 * Delete a campaign / ad set / ad on Meta + remove the local mirror.
 *
 * DESTRUCTIVE + IRREVERSIBLE. The senior's hard rule: this only runs behind
 * a confirmation flow (UI enforces type-to-confirm for cascading deletes).
 * Here we still:
 *   1. Resolve the entity → account → connection (must be selected-for-sync).
 *   2. AuditLog BEFORE the Meta call (snapshot of what's being destroyed).
 *   3. DELETE on Meta — cascades to children on Meta's side.
 *   4. Delete the local row — our schema's onDelete: Cascade removes the
 *      mirrored children too, matching Meta.
 *   5. Stamp the audit row.
 *
 * Distinct from Archive (reversible, status=ARCHIVED) which lives in the
 * bulk-status flow. Delete cannot be undone — Meta purges deleted objects.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export type DeletableLevel =
  | "campaign"
  | "adset"
  | "ad"
  | "audience"
  | "conversion"
  | "creative"
  | "image"
  | "video";

export interface DeleteEntityInput {
  level: DeletableLevel;
  metaId: string;
}

export interface DeleteEntityResult {
  level: DeletableLevel;
  metaId: string;
  // Children removed locally (Meta cascades on its side regardless). Always
  // zero for non-cascading entities (ad / audience / conversion).
  removedChildren: { adSets: number; ads: number };
}

export async function deleteEntity(
  input: DeleteEntityInput,
): Promise<DeleteEntityResult> {
  const { level, metaId } = input;
  const resolved = await resolveDeletable(level, metaId);

  const auditRow = await prisma.auditLog.create({
    data: {
      action: `${level}.delete`,
      targetType: level,
      targetId: metaId,
      before: resolved.snapshot as Prisma.InputJsonValue,
      after: { _pending: true },
    },
  });

  try {
    if (level === "image") {
      // Images delete by hash through the account endpoint, not /{id}.
      await metaClient.deleteAdImage(
        resolved.connectionId,
        resolved.metaAdAccountId as string,
        metaId,
      );
    } else {
      await metaClient.deleteEntity(resolved.connectionId, metaId);
    }
  } catch (err) {
    const message =
      err instanceof MetaApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    await prisma.auditLog.update({
      where: { id: auditRow.id },
      data: { after: { _failed: true, _error: message } },
    });
    throw err;
  }

  // Remove the local mirror. Schema cascades children (AdSet/Ad) for us.
  let removedChildren = { adSets: 0, ads: 0 };
  if (level === "campaign") {
    removedChildren = {
      adSets: await prisma.adSet.count({
        where: { campaignId: resolved.localId },
      }),
      ads: await prisma.ad.count({
        where: { adSet: { campaignId: resolved.localId } },
      }),
    };
    await prisma.campaign.delete({ where: { id: resolved.localId } });
  } else if (level === "adset") {
    removedChildren = {
      adSets: 0,
      ads: await prisma.ad.count({ where: { adSetId: resolved.localId } }),
    };
    await prisma.adSet.delete({ where: { id: resolved.localId } });
  } else if (level === "ad") {
    await prisma.ad.delete({ where: { id: resolved.localId } });
  } else if (level === "audience") {
    await prisma.customAudience.delete({ where: { id: resolved.localId } });
  } else if (level === "conversion") {
    await prisma.customConversion.delete({ where: { id: resolved.localId } });
  } else if (level === "creative") {
    await prisma.adCreative.delete({ where: { id: resolved.localId } });
  } else if (level === "image") {
    await prisma.adImage.delete({ where: { id: resolved.localId } });
  } else {
    await prisma.adVideo.delete({ where: { id: resolved.localId } });
  }

  await prisma.auditLog.update({
    where: { id: auditRow.id },
    data: { after: { _deleted: true, removedChildren } },
  });

  return { level, metaId, removedChildren };
}

/**
 * Resolve a deletable entity: its local row id, the connection id for the
 * Meta call, and a `before` snapshot for the audit log. Throws if it isn't
 * in a selected-for-sync account.
 */
async function resolveDeletable(
  level: DeletableLevel,
  metaId: string,
): Promise<{
  localId: string;
  connectionId: string;
  snapshot: Record<string, unknown>;
  // Only set for images, which delete via the account endpoint by hash.
  metaAdAccountId?: string;
}> {
  if (level === "campaign") {
    const c = await prisma.campaign.findFirst({
      where: { metaCampaignId: metaId, adAccount: { selectedForSync: true } },
      include: {
        adAccount: { include: { business: { include: { connection: true } } } },
      },
    });
    if (!c) throw new Error("Campaign not found in a selected-for-sync account");
    return {
      localId: c.id,
      connectionId: c.adAccount.business.connection.id,
      snapshot: { name: c.name, status: c.status, objective: c.objective },
    };
  }
  if (level === "adset") {
    const s = await prisma.adSet.findFirst({
      where: { metaAdSetId: metaId, adAccount: { selectedForSync: true } },
      include: {
        adAccount: { include: { business: { include: { connection: true } } } },
      },
    });
    if (!s) throw new Error("Ad set not found in a selected-for-sync account");
    return {
      localId: s.id,
      connectionId: s.adAccount.business.connection.id,
      snapshot: { name: s.name, status: s.status },
    };
  }
  if (level === "ad") {
    const a = await prisma.ad.findFirst({
      where: { metaAdId: metaId, adAccount: { selectedForSync: true } },
      include: {
        adAccount: { include: { business: { include: { connection: true } } } },
      },
    });
    if (!a) throw new Error("Ad not found in a selected-for-sync account");
    return {
      localId: a.id,
      connectionId: a.adAccount.business.connection.id,
      snapshot: { name: a.name, status: a.status },
    };
  }
  if (level === "audience") {
    const aud = await prisma.customAudience.findFirst({
      where: { metaAudienceId: metaId, adAccount: { selectedForSync: true } },
      include: {
        adAccount: { include: { business: { include: { connection: true } } } },
      },
    });
    if (!aud) {
      throw new Error("Audience not found in a selected-for-sync account");
    }
    return {
      localId: aud.id,
      connectionId: aud.adAccount.business.connection.id,
      snapshot: { name: aud.name, subtype: aud.subtype },
    };
  }
  if (level === "conversion") {
    const conv = await prisma.customConversion.findFirst({
      where: { metaConversionId: metaId, adAccount: { selectedForSync: true } },
      include: {
        adAccount: { include: { business: { include: { connection: true } } } },
      },
    });
    if (!conv) {
      throw new Error("Conversion not found in a selected-for-sync account");
    }
    return {
      localId: conv.id,
      connectionId: conv.adAccount.business.connection.id,
      snapshot: { name: conv.name, customEventType: conv.customEventType },
    };
  }
  if (level === "creative") {
    const cr = await prisma.adCreative.findFirst({
      where: { metaCreativeId: metaId, adAccount: { selectedForSync: true } },
      include: {
        adAccount: { include: { business: { include: { connection: true } } } },
      },
    });
    if (!cr) {
      throw new Error("Creative not found in a selected-for-sync account");
    }
    return {
      localId: cr.id,
      connectionId: cr.adAccount.business.connection.id,
      snapshot: { name: cr.name, title: cr.title },
    };
  }
  if (level === "image") {
    // For images, `metaId` is the content hash, not a numeric id.
    const img = await prisma.adImage.findFirst({
      where: { metaImageHash: metaId, adAccount: { selectedForSync: true } },
      include: {
        adAccount: { include: { business: { include: { connection: true } } } },
      },
    });
    if (!img) {
      throw new Error("Image not found in a selected-for-sync account");
    }
    return {
      localId: img.id,
      connectionId: img.adAccount.business.connection.id,
      metaAdAccountId: img.adAccount.metaAdAccountId,
      snapshot: { name: img.name, hash: img.metaImageHash },
    };
  }
  // video
  const vid = await prisma.adVideo.findFirst({
    where: { metaVideoId: metaId, adAccount: { selectedForSync: true } },
    include: {
      adAccount: { include: { business: { include: { connection: true } } } },
    },
  });
  if (!vid) {
    throw new Error("Video not found in a selected-for-sync account");
  }
  return {
    localId: vid.id,
    connectionId: vid.adAccount.business.connection.id,
    snapshot: { title: vid.title, videoId: vid.metaVideoId },
  };
}
