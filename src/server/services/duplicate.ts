/**
 * Duplicate a campaign / ad set / ad on Meta + bring the copy into local DB.
 *
 * Flow (mirrors the create/update services):
 *   1. Resolve the source entity → account → connection (must be in a
 *      selected-for-sync account).
 *   2. AuditLog row BEFORE the copy.
 *   3. POST /{id}/copies (status_option=PAUSED so the copy never auto-spends).
 *   4. Re-sync that level for the account so the new copy appears locally.
 *      For a deep copy the child entities are created on Meta too, but show
 *      up locally only when their level is synced (drill in + sync) — noted
 *      in the result so the UI can hint that.
 *
 * Status is forced to PAUSED on the copy regardless of the source: an
 * agency cloning a campaign should review before it spends. This keeps
 * duplication non-destructive and safe by default.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";
import { syncCampaignsForAccount } from "@/server/services/sync/sync-campaigns";
import { syncAdSetsForAccount } from "@/server/services/sync/sync-adsets";
import { syncAdsForAccount } from "@/server/services/sync/sync-ads";

export type DuplicateLevel = "campaign" | "adset" | "ad";

export interface DuplicateEntityInput {
  level: DuplicateLevel;
  metaId: string;
  // campaign/adset only — also copy children. Ignored for ads.
  deepCopy?: boolean;
}

export interface DuplicateEntityResult {
  level: DuplicateLevel;
  sourceMetaId: string;
  newMetaId: string | null;
  deepCopy: boolean;
}

export async function duplicateEntity(
  input: DuplicateEntityInput,
): Promise<DuplicateEntityResult> {
  const { level, metaId } = input;
  const deepCopy = level === "ad" ? false : Boolean(input.deepCopy);

  // Resolve the source + its account/connection, per level.
  const { localAccountId, connectionId, sourceName } =
    await resolveSource(level, metaId);

  const intent = {
    level,
    sourceMetaId: metaId,
    sourceName,
    deepCopy,
    statusOption: "PAUSED",
  };

  const auditRow = await prisma.auditLog.create({
    data: {
      action: `${level}.duplicate`,
      targetType: level,
      targetId: metaId,
      before: {},
      after: { ...intent, _pending: true },
    },
  });

  let newId: string | null;
  try {
    const r = await metaClient.copyEntity(connectionId, metaId, {
      statusOption: "PAUSED",
      deepCopy: level === "ad" ? undefined : deepCopy,
      renameSuffix: " - Copy",
    });
    newId = r.newId;
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

  // Pull the new copy into local DB by re-syncing the affected levels for
  // the account. A deep copy also creates child entities on Meta, so we sync
  // those levels too — otherwise the copy shows up empty (its children exist
  // on Meta but not locally). Best-effort: if a sync hiccups, the copy still
  // exists on Meta and the next manual sync surfaces it.
  try {
    if (level === "campaign") {
      await syncCampaignsForAccount(localAccountId);
      if (deepCopy) {
        await syncAdSetsForAccount(localAccountId);
        await syncAdsForAccount(localAccountId);
      }
    } else if (level === "adset") {
      await syncAdSetsForAccount(localAccountId);
      if (deepCopy) {
        await syncAdsForAccount(localAccountId);
      }
    } else {
      await syncAdsForAccount(localAccountId);
    }
  } catch (err) {
    console.error("post-duplicate sync failed (non-fatal):", err);
  }

  await prisma.auditLog.update({
    where: { id: auditRow.id },
    data: { targetId: newId ?? metaId, after: { ...intent, newMetaId: newId } },
  });

  return { level, sourceMetaId: metaId, newMetaId: newId, deepCopy };
}

/**
 * Look up the source entity for the given level and return the local account
 * id (for re-sync), the connection id (for the Meta call), and the source's
 * name (for the audit log). Throws if not found in a selected-for-sync acct.
 */
async function resolveSource(
  level: DuplicateLevel,
  metaId: string,
): Promise<{
  localAccountId: string;
  connectionId: string;
  sourceName: string;
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
      localAccountId: c.adAccountId,
      connectionId: c.adAccount.business.connection.id,
      sourceName: c.name,
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
      localAccountId: s.adAccountId,
      connectionId: s.adAccount.business.connection.id,
      sourceName: s.name,
    };
  }
  const a = await prisma.ad.findFirst({
    where: { metaAdId: metaId, adAccount: { selectedForSync: true } },
    include: {
      adAccount: { include: { business: { include: { connection: true } } } },
    },
  });
  if (!a) throw new Error("Ad not found in a selected-for-sync account");
  return {
    localAccountId: a.adAccountId,
    connectionId: a.adAccount.business.connection.id,
    sourceName: a.name,
  };
}
