/**
 * Creative classification — tag every indexed ad creative with hook type,
 * funnel stage, angle, USP and persona, then join those tags against real
 * performance.
 *
 * This is the half that competitors structurally cannot do. Public ad-spy
 * tools can cluster creatives by hook too — they read the same ad copy. What
 * they cannot do is attach spend, CPA and ROAS to the cluster, because that
 * data is private to the account. "Question hooks outperform statements
 * 2.1x here" is a sentence only a tool inside the ad account can say.
 *
 * Tags are written into `Embedding.metadata` rather than a new table. The
 * embedding row is already the per-creative record the RAG layer keys on,
 * already carries the performance snapshot, and is already tenant-scoped —
 * a parallel table would need all three re-established and kept in sync.
 * `patchMetadata` merges tags in without re-embedding.
 *
 * Cost control: creatives are classified in batches through gpt-4o-mini,
 * and rows already carrying the current TAXONOMY_VERSION are skipped, so
 * re-running after a sync only pays for what's new.
 */

import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/llm/chat";
import { patchMetadata } from "@/server/services/rag";
import { formatMediaContext } from "./analyze-media";
import {
  buildClassifyPrompt,
  coerceTags,
  CREATIVE_TAGS_SCHEMA,
  TAXONOMY_VERSION,
  type CreativeTags,
} from "@/lib/creative-taxonomy";

/**
 * How many creatives go into one LLM call.
 *
 * Batching trades accuracy for cost. Too large and the model starts losing
 * track of which creative it is on and the id echoes drift; 8 keeps every
 * batch comfortably inside the output cap while cutting call count ~8x.
 */
const BATCH_SIZE = 8;

const NAMESPACE = "ads";
const SOURCE_TYPE = "AdCreative";

export interface ClassifyResult {
  totalIndexed: number;
  alreadyTagged: number;
  classified: number;
  failed: number;
}

interface EmbeddingRow {
  sourceId: string;
  content: string;
  metadata: Record<string, unknown> | null;
}

/**
 * Classify one account's indexed creatives.
 *
 * `force` re-tags everything, including rows already at the current
 * taxonomy version — used after a taxonomy change when the version bump
 * alone would leave old rows stranded on a label set that no longer means
 * the same thing.
 */
export async function classifyCreativesForAccount(
  adAccountId: string,
  opts: { force?: boolean } = {},
): Promise<ClassifyResult> {
  const account = await prisma.metaAdAccount.findUnique({
    where: { id: adAccountId },
    select: { id: true, businessId: true },
  });
  if (!account) throw new Error("Ad account not found");

  // Typed client can read Embedding fine — only the `vector` column needs
  // raw SQL, and this query never touches it.
  const rows = (await prisma.embedding.findMany({
    where: {
      namespace: NAMESPACE,
      sourceType: SOURCE_TYPE,
      adAccountId: account.id,
    },
    select: { sourceId: true, content: true, metadata: true },
  })) as unknown as EmbeddingRow[];

  const needsWork = rows.filter((r) => {
    if (opts.force) return true;
    const v = (r.metadata as Record<string, unknown> | null)?.taxonomyVersion;
    return typeof v !== "number" || v < TAXONOMY_VERSION;
  });

  const result: ClassifyResult = {
    totalIndexed: rows.length,
    alreadyTagged: rows.length - needsWork.length,
    classified: 0,
    failed: 0,
  };
  if (needsWork.length === 0) return result;

  // Media context: transcripts for video-backed creatives, vision
  // descriptions for image-backed ones (both cached by analyze-media.ts).
  // Appended to the classifier input only — the embedding content itself is
  // not rewritten here, so this costs no re-embedding. A creative whose
  // media was never analysed classifies exactly as before, from copy alone.
  const creatives = await prisma.adCreative.findMany({
    where: { adAccountId: account.id },
    select: { metaCreativeId: true, videoId: true, imageHash: true },
  });
  const videoIds = creatives.map((c) => c.videoId).filter(Boolean) as string[];
  const imageHashes = creatives.map((c) => c.imageHash).filter(Boolean) as string[];
  const [videos, images] = await Promise.all([
    videoIds.length
      ? prisma.adVideo.findMany({
          where: { adAccountId: account.id, metaVideoId: { in: videoIds } },
          select: { metaVideoId: true, transcript: true },
        })
      : Promise.resolve([]),
    imageHashes.length
      ? prisma.adImage.findMany({
          where: { adAccountId: account.id, metaImageHash: { in: imageHashes } },
          select: { metaImageHash: true, aiDescription: true },
        })
      : Promise.resolve([]),
  ]);
  const transcriptByVideo = new Map(videos.map((v) => [v.metaVideoId, v.transcript]));
  const descByHash = new Map(images.map((i) => [i.metaImageHash, i.aiDescription]));
  const mediaByCreative = new Map<string, string>();
  for (const c of creatives) {
    const ctx = formatMediaContext({
      transcript: c.videoId ? transcriptByVideo.get(c.videoId) : null,
      imageDescription: c.imageHash ? descByHash.get(c.imageHash) : null,
    });
    if (ctx) mediaByCreative.set(c.metaCreativeId, ctx);
  }

  for (let i = 0; i < needsWork.length; i += BATCH_SIZE) {
    const batch = needsWork.slice(i, i + BATCH_SIZE);
    let tagsById: Map<string, CreativeTags>;

    try {
      const out = await completeJson<{ results?: unknown[] }>(
        buildClassifyPrompt(
          batch.map((b) => {
            const media = mediaByCreative.get(b.sourceId);
            return {
              id: b.sourceId,
              content: media ? `${b.content}\n${media}` : b.content,
            };
          }),
        ),
        {
          model: "gpt-4o-mini",
          // Classification is a labelling task, not a creative one — the
          // same ad must land in the same bucket on every run or the
          // aggregates move on their own between passes.
          temperature: 0,
          maxTokens: 2048,
          system:
            "You label advertising creatives into a fixed taxonomy. You are precise, literal, and never invent labels outside the allowed values.",
        },
        { name: "creative_tags", schema: CREATIVE_TAGS_SCHEMA as unknown as Record<string, unknown> },
      );

      tagsById = new Map(
        (out.results ?? []).map((r) => {
          const id = String((r as Record<string, unknown>).id ?? "");
          return [id, coerceTags(r)];
        }),
      );
    } catch (e) {
      // One bad batch must not abort the pass — the next batch may be fine,
      // and a partial tagging is strictly better than none.
      console.error(
        `[classify-creatives] batch failed (${batch.length} creatives):`,
        e instanceof Error ? e.message : e,
      );
      result.failed += batch.length;
      continue;
    }

    for (const row of batch) {
      const tags = tagsById.get(row.sourceId);
      if (!tags) {
        // The model dropped or renamed an id. Counted, not retried — a
        // silent skip here would look identical to "this creative has no
        // tags yet" on the next run, which is at least self-healing.
        result.failed++;
        continue;
      }
      try {
        await patchMetadata({
          namespace: NAMESPACE,
          sourceType: SOURCE_TYPE,
          sourceId: row.sourceId,
          // mediaUsed records whether footage/imagery informed these tags —
          // the UI uses it to say how many tags are copy-only.
          patch: { ...tags, mediaUsed: mediaByCreative.has(row.sourceId) },
          adAccountId: account.id,
        });
        result.classified++;
      } catch (e) {
        console.error(
          `[classify-creatives] failed to write tags for ${row.sourceId}:`,
          e instanceof Error ? e.message : e,
        );
        result.failed++;
      }
    }
  }

  return result;
}

// ─── Aggregation ─────────────────────────────────────────────────────────

export interface TagPerformance {
  key: string;
  label: string;
  creativeCount: number;
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenueCents: number;
  ctr: number;
  roas: number;
  cpaCents: number | null;
}

export type TagDimension = "hookType" | "angle" | "funnelStage";

interface PerfShape {
  spendCents?: number;
  impressions?: number;
  clicks?: number;
  conversionsCount?: number;
  revenueCents?: number;
}

/**
 * Group an account's classified creatives by one taxonomy dimension and sum
 * the performance snapshot each embedding row already carries.
 *
 * Done in JS over the account's rows rather than in SQL because the numbers
 * live inside a jsonb blob; at the scale of one account's creatives (tens to
 * low thousands) the round trip dominates either way, and readable grouping
 * beats a jsonb-casting query nobody will want to touch later.
 *
 * `minCreatives` exists to keep the output honest. A bucket with one
 * creative and a lucky week shows an eye-watering ROAS and means nothing;
 * surfacing it as "your best hook" would be actively misleading.
 */
export async function getTagPerformance(
  adAccountId: string,
  dimension: TagDimension,
  opts: { minCreatives?: number } = {},
): Promise<{ dimension: TagDimension; groups: TagPerformance[]; untagged: number }> {
  const minCreatives = opts.minCreatives ?? 1;

  const rows = (await prisma.embedding.findMany({
    where: {
      namespace: NAMESPACE,
      sourceType: SOURCE_TYPE,
      adAccountId,
    },
    select: { metadata: true },
  })) as unknown as Array<{ metadata: Record<string, unknown> | null }>;

  const buckets = new Map<string, TagPerformance>();
  let untagged = 0;

  for (const row of rows) {
    const md = row.metadata ?? {};
    const key = md[dimension];
    if (typeof key !== "string" || !key) {
      untagged++;
      continue;
    }

    // index-ad-copy.ts writes the performance snapshot as TOP-LEVEL metadata
    // keys (spendCents, impressions, …), not under a nested "performance"
    // object — so the whole metadata blob is the performance shape.
    const perf = md as PerfShape;
    const cur =
      buckets.get(key) ??
      ({
        key,
        label: key,
        creativeCount: 0,
        spendCents: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenueCents: 0,
        ctr: 0,
        roas: 0,
        cpaCents: null,
      } satisfies TagPerformance);

    cur.creativeCount += 1;
    cur.spendCents += Number(perf.spendCents ?? 0);
    cur.impressions += Number(perf.impressions ?? 0);
    cur.clicks += Number(perf.clicks ?? 0);
    cur.conversions += Number(perf.conversionsCount ?? 0);
    cur.revenueCents += Number(perf.revenueCents ?? 0);
    buckets.set(key, cur);
  }

  const groups = [...buckets.values()]
    .filter((g) => g.creativeCount >= minCreatives)
    .map((g) => ({
      ...g,
      ctr: g.impressions > 0 ? g.clicks / g.impressions : 0,
      roas: g.spendCents > 0 ? g.revenueCents / g.spendCents : 0,
      cpaCents: g.conversions > 0 ? Math.round(g.spendCents / g.conversions) : null,
    }))
    .sort((a, b) => b.spendCents - a.spendCents);

  return { dimension, groups, untagged };
}
