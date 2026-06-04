/**
 * Backfill ad-copy embeddings for one account.
 *
 * Iterates the account's `AdCreative` rows (already mirrored locally by the
 * creatives sync) and indexes each one's copy as a single RAG chunk in the
 * "ads" namespace. The chunk's `content` is a compact "Headline / Primary
 * text / CTA / URL" block — readable as-is when retrieved and surfaced as
 * brand-voice context to the LLM.
 *
 * Idempotent: re-running for the same account upserts each chunk by
 * (namespace, sourceType, sourceId), so it's safe to call any time
 * creatives are added or edited.
 *
 * Serial today (one embedding call per creative). At ~100 ms / call this is
 * fine for the first thousand or so; we can batch via embedBatch + bulk
 * insert later if any account grows past that.
 */

import { prisma } from "@/lib/db/prisma";
import { indexText } from "@/server/services/rag";

export interface BackfillResult {
  totalCreatives: number;
  indexed: number;
  skipped: number;
}

export async function backfillAdCopyForAccount(
  metaAdAccountIdParam: string,
): Promise<BackfillResult> {
  const metaAdAccountId = metaAdAccountIdParam.startsWith("act_")
    ? metaAdAccountIdParam
    : `act_${metaAdAccountIdParam}`;

  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId, selectedForSync: true },
    select: { id: true, businessId: true },
  });
  if (!account) {
    throw new Error("Ad account not found or not selected for sync");
  }

  const creatives = await prisma.adCreative.findMany({
    where: {
      adAccountId: account.id,
      // Only creatives that actually carry copy — skip image-only / video-only
      // shells, which would just embed an empty hint string.
      OR: [{ body: { not: null } }, { title: { not: null } }],
    },
    select: {
      metaCreativeId: true,
      name: true,
      body: true,
      title: true,
      callToActionType: true,
      linkUrl: true,
    },
  });

  let indexed = 0;
  let skipped = 0;
  for (const c of creatives) {
    const parts: string[] = [];
    if (c.title) parts.push(`Headline: ${c.title.trim()}`);
    if (c.body) parts.push(`Primary text: ${c.body.trim()}`);
    if (c.callToActionType) parts.push(`CTA: ${c.callToActionType}`);
    if (c.linkUrl) parts.push(`URL: ${c.linkUrl.trim()}`);
    const content = parts.join("\n");

    // Embedding model fails on empty input; skip anything too thin to be
    // useful as brand-voice context anyway.
    if (content.length < 10) {
      skipped++;
      continue;
    }

    await indexText({
      namespace: "ads",
      sourceType: "AdCreative",
      sourceId: c.metaCreativeId,
      content,
      adAccountId: account.id,
      businessId: account.businessId,
      metadata: {
        name: c.name ?? null,
        callToActionType: c.callToActionType ?? null,
      },
    });
    indexed++;
  }

  return {
    totalCreatives: creatives.length,
    indexed,
    skipped,
  };
}
