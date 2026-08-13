/**
 * Read-only tools the campaign copilot may call while it works out a plan.
 *
 * EVERY TOOL HERE IS A READ. There is deliberately no create_campaign,
 * no set_budget, no upload. The agent explores your account through these,
 * then commits its conclusion once by calling submit_plan, and that plan
 * still goes through validatePlan before a human sees it.
 *
 * That split is what keeps an agentic loop safe here. Letting a model call
 * write tools turn by turn would mean approving fourteen separate actions
 * and never seeing the shape, and it would leave a half-built campaign
 * behind when the fifth call failed. Exploration wants a loop; commitment
 * wants an artefact.
 *
 * search_creatives is the tool that earns the architecture. Stuffing 44
 * image descriptions and 38 transcripts into one prompt is both expensive
 * and bad at recall: the model skims. Letting it ask "what do we have about
 * missed calls at night" and get five ranked answers is how it finds the
 * asset a human would have picked.
 */

import { prisma } from "@/lib/db/prisma";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const COPILOT_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_creatives",
      description:
        "Search the account's image and video library by what the asset actually SHOWS or SAYS, using AI descriptions and transcripts. Use this to find a creative that fits the brief instead of guessing from filenames. Returns ranked matches with the id you must reference in the plan.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description:
              "What you are looking for, in plain language. e.g. 'a woman speaking to camera in an office' or 'missed calls at night'.",
          },
          mediaType: {
            type: "string",
            enum: ["image", "video", "any"],
            description: "Restrict to one kind of asset. Defaults to any.",
          },
          limit: { type: "integer", description: "Max results, default 6." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_audiences",
      description:
        "Saved custom audiences on this ad account, with approximate sizes. Use before referencing an audience id in targeting; ids not in this list are rejected.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_conversions",
      description:
        "Custom conversions and the pixels behind them. Needed for any objective that optimises for a conversion, since the plan must name what to count.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_past_performance",
      description:
        "How this account's campaigns actually performed: spend, impressions, clicks, CTR and conversions per campaign over a recent window. Use it to ground budget and structure decisions in what worked here rather than generic best practice.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          days: { type: "integer", description: "Lookback window, default 90." },
        },
      },
    },
  },
];

export interface ToolContext {
  /** Local MetaAdAccount id. */
  adAccountId: string;
  metaAdAccountId: string;
  currency: string;
}

/**
 * Run one tool call. Returns a JSON-serialisable result.
 *
 * Never throws: a tool that fails returns an object saying so, because an
 * exception here aborts the whole conversation, whereas an error the model
 * can read lets it try a different approach.
 */
export async function runCopilotTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<unknown> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    return { error: "Arguments were not valid JSON." };
  }

  try {
    switch (name) {
      case "search_creatives":
        return await searchCreatives(ctx, args);
      case "list_audiences":
        return await listAudiences(ctx);
      case "list_conversions":
        return await listConversions(ctx);
      case "get_past_performance":
        return await getPastPerformance(ctx, args);
      default:
        return { error: `Unknown tool "${name}".` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Tool failed" };
  }
}

/**
 * Keyword search over descriptions and transcripts.
 *
 * Deliberately not the pgvector RAG index: that is scoped to ad COPY
 * embeddings, and reindexing it to carry asset descriptions is a bigger
 * change than this needs. Scoring on term overlap over a few dozen rows is
 * both adequate and explainable, and an account with thousands of assets can
 * graduate to embeddings without the tool contract changing.
 */
async function searchCreatives(ctx: ToolContext, args: Record<string, unknown>) {
  const query = String(args.query ?? "").toLowerCase();
  const mediaType = String(args.mediaType ?? "any");
  const limit = Math.min(Number(args.limit ?? 6) || 6, 15);
  const terms = query.split(/\W+/).filter((t) => t.length > 3);

  const score = (text: string | null): number => {
    if (!text) return 0;
    const hay = text.toLowerCase();
    return terms.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0);
  };

  const results: Array<Record<string, unknown>> = [];

  if (mediaType !== "video") {
    const images = await prisma.adImage.findMany({
      where: { adAccountId: ctx.adAccountId },
      select: { metaImageHash: true, name: true, aiDescription: true },
    });
    for (const i of images) {
      results.push({
        kind: "image",
        imageHash: i.metaImageHash,
        name: i.name,
        shows: i.aiDescription?.slice(0, 300) ?? null,
        analysed: Boolean(i.aiDescription),
        _score: score(i.aiDescription) + score(i.name),
      });
    }
  }

  if (mediaType !== "image") {
    const videos = await prisma.adVideo.findMany({
      where: { adAccountId: ctx.adAccountId, status: "ready" },
      select: {
        metaVideoId: true,
        title: true,
        transcript: true,
        sourceUrl: true,
      },
    });
    for (const v of videos) {
      results.push({
        kind: "video",
        videoId: v.metaVideoId,
        name: v.title,
        says: v.transcript?.slice(0, 300) ?? null,
        analysed: Boolean(v.transcript),
        // Page-owned videos have no downloadable file, so they can never be
        // transcribed. Saying so stops the model reading a null transcript
        // as "not analysed yet" and waiting for something that never comes.
        transcribable: Boolean(v.sourceUrl),
        _score: score(v.transcript) + score(v.title),
      });
    }
  }

  results.sort((a, b) => Number(b._score) - Number(a._score));
  const top = results.slice(0, limit).map(({ _score, ...rest }) => {
    void _score;
    return rest;
  });

  return {
    matches: top,
    note:
      top.length === 0
        ? "Nothing in the library matched. Say so in the rationale rather than inventing an asset id."
        : undefined,
  };
}

async function listAudiences(ctx: ToolContext) {
  const rows = await prisma.customAudience.findMany({
    where: { adAccountId: ctx.adAccountId },
    select: { metaAudienceId: true, name: true, approximateCount: true, subtype: true },
    take: 60,
  });
  return {
    audiences: rows.map((a) => ({
      id: a.metaAudienceId,
      name: a.name,
      subtype: a.subtype,
      approximateSize: a.approximateCount,
    })),
  };
}

async function listConversions(ctx: ToolContext) {
  const rows = await prisma.customConversion.findMany({
    where: { adAccountId: ctx.adAccountId },
    select: {
      metaConversionId: true,
      name: true,
      customEventType: true,
      eventSourceId: true,
    },
    take: 40,
  });
  return {
    customConversions: rows.map((c) => ({
      id: c.metaConversionId,
      name: c.name,
      eventType: c.customEventType,
      pixelId: c.eventSourceId,
    })),
    // eventSourceId IS the pixel the conversion fires on, which is why
    // pixels are not mirrored separately.
    pixels: [...new Set(rows.map((c) => c.eventSourceId).filter(Boolean))],
  };
}

async function getPastPerformance(ctx: ToolContext, args: Record<string, unknown>) {
  const days = Math.min(Number(args.days ?? 90) || 90, 365);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const rows = await prisma.insightsSnapshot.groupBy({
    by: ["entityId"],
    where: { adAccountId: ctx.adAccountId, level: "campaign", date: { gte: since } },
    _sum: {
      spendCents: true,
      impressions: true,
      clicks: true,
      conversionsCount: true,
    },
  });
  if (rows.length === 0) {
    return {
      windowDays: days,
      campaigns: [],
      note: "No delivery in this window. Do not infer benchmarks from an empty account.",
    };
  }

  const names = new Map(
    (
      await prisma.campaign.findMany({
        where: { adAccountId: ctx.adAccountId },
        select: { metaCampaignId: true, name: true, objective: true },
      })
    ).map((c) => [c.metaCampaignId, c]),
  );

  const campaigns = rows
    .map((r) => {
      const impressions = r._sum.impressions ?? 0;
      const clicks = r._sum.clicks ?? 0;
      const spend = (r._sum.spendCents ?? 0) / 100;
      const conversions = r._sum.conversionsCount ?? 0;
      return {
        name: names.get(r.entityId)?.name ?? r.entityId,
        objective: names.get(r.entityId)?.objective ?? null,
        spend,
        impressions,
        clicks,
        ctrPercent: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
        conversions,
        costPerConversion: conversions > 0 ? Number((spend / conversions).toFixed(2)) : null,
      };
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 20);

  return { windowDays: days, currency: ctx.currency, campaigns };
}
