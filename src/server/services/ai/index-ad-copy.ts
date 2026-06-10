/**
 * Backfill ad-copy embeddings for one account, with performance metadata.
 *
 * Iterates the account's `AdCreative` rows (already mirrored locally by the
 * creatives sync) and indexes each one's copy as a single RAG chunk in the
 * "ads" namespace. The chunk's `content` is a compact "Headline / Primary
 * text / CTA / URL" block — readable as-is when retrieved and surfaced as
 * brand-voice context to the LLM.
 *
 * Performance metadata (90-day window aggregate spend / impressions /
 * clicks / conversions / revenue / ROAS / CTR) is computed at index time
 * and stored on the embedding row. The cross-account "winners" search
 * uses it to weight similarity hits by real outcomes — semantic match +
 * proven performance is the whole point of pattern-transfer.
 *
 * Idempotent: re-running for the same account upserts each chunk by
 * (namespace, sourceType, sourceId), so it's safe to call any time
 * creatives are added, edited, or new insights land.
 *
 * Serial today (one embedding call per creative). Fine for the first
 * thousand or so; batch via embedBatch + bulk insert when an account
 * grows past that.
 */

import { prisma } from "@/lib/db/prisma";
import { indexText } from "@/server/services/rag";

export interface BackfillResult {
  totalCreatives: number;
  indexed: number;
  skipped: number;
}

const PERFORMANCE_WINDOW_DAYS = 90;

function safeDiv(n: number, d: number): number {
  return d > 0 ? n / d : 0;
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
  if (creatives.length === 0) {
    return { totalCreatives: 0, indexed: 0, skipped: 0 };
  }

  // Pull aggregate ad-level performance for everything in this account in
  // one query, then look up per creative. Cheaper than a per-creative join
  // for accounts with many ads.
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - PERFORMANCE_WINDOW_DAYS);

  const adsWithCreative = await prisma.ad.findMany({
    where: {
      adAccountId: account.id,
      metaCreativeId: { not: null },
    },
    select: { metaAdId: true, metaCreativeId: true },
  });
  const adIdToCreativeId = new Map<string, string>();
  for (const a of adsWithCreative) {
    if (a.metaCreativeId) adIdToCreativeId.set(a.metaAdId, a.metaCreativeId);
  }

  // Sum insights at ad level over the window — group by creative through
  // the ad → creative map we just built.
  const insights = await prisma.insightsSnapshot.findMany({
    where: {
      adAccountId: account.id,
      level: "ad",
      date: { gte: since },
      entityId: { in: Array.from(adIdToCreativeId.keys()) },
    },
    select: {
      entityId: true,
      spendCents: true,
      impressions: true,
      clicks: true,
      conversionsCount: true,
      revenueCents: true,
    },
  });

  interface PerfTotals {
    spendCents: number;
    impressions: number;
    clicks: number;
    conversionsCount: number;
    revenueCents: number;
  }
  const perfByCreative = new Map<string, PerfTotals>();
  for (const row of insights) {
    const creativeId = adIdToCreativeId.get(row.entityId);
    if (!creativeId) continue;
    const cur = perfByCreative.get(creativeId) ?? {
      spendCents: 0,
      impressions: 0,
      clicks: 0,
      conversionsCount: 0,
      revenueCents: 0,
    };
    cur.spendCents += row.spendCents;
    cur.impressions += row.impressions;
    cur.clicks += row.clicks;
    cur.conversionsCount += row.conversionsCount;
    cur.revenueCents += row.revenueCents;
    perfByCreative.set(creativeId, cur);
  }

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

    const perf = perfByCreative.get(c.metaCreativeId) ?? {
      spendCents: 0,
      impressions: 0,
      clicks: 0,
      conversionsCount: 0,
      revenueCents: 0,
    };

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
        // Performance over the last `PERFORMANCE_WINDOW_DAYS`. Stored as-is
        // so the cross-account search can rank by ROAS / CTR / spend.
        perfWindowDays: PERFORMANCE_WINDOW_DAYS,
        spendCents: perf.spendCents,
        impressions: perf.impressions,
        clicks: perf.clicks,
        conversionsCount: perf.conversionsCount,
        revenueCents: perf.revenueCents,
        ctr: safeDiv(perf.clicks, perf.impressions),
        roas: safeDiv(perf.revenueCents, perf.spendCents),
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

// ── Portfolio-wide refresh ──────────────────────────────────────────────
//
// Driven by the nightly cron at /api/cron/reindex/ad-copy. Walks every
// selected-for-sync account and re-runs the backfill. The point is to
// keep the performance metadata (ROAS / CTR / spend) on each embedding
// fresh as new insights land overnight — otherwise the cross-account
// winners search would re-rank against stale numbers.
//
// Failures on one account don't stop the others; the cron is best-effort.

export interface ReindexAllResult {
  accountsScanned: number;
  perAccount: Array<{
    metaAdAccountId: string;
    name: string;
    result?: BackfillResult;
    error?: string;
  }>;
}

export async function reindexAllAccountsAdCopy(): Promise<ReindexAllResult> {
  const accounts = await prisma.metaAdAccount.findMany({
    where: { selectedForSync: true },
    select: {
      metaAdAccountId: true,
      name: true,
    },
    distinct: ["metaAdAccountId"],
  });

  const perAccount: ReindexAllResult["perAccount"] = [];
  for (const acc of accounts) {
    try {
      const result = await backfillAdCopyForAccount(acc.metaAdAccountId);
      perAccount.push({
        metaAdAccountId: acc.metaAdAccountId,
        name: acc.name,
        result,
      });
    } catch (err) {
      perAccount.push({
        metaAdAccountId: acc.metaAdAccountId,
        name: acc.name,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }
  return {
    accountsScanned: accounts.length,
    perAccount,
  };
}
