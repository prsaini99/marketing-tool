/**
 * Tool registry for the AI Assistant chat.
 *
 * Each tool is a small, well-scoped read function the LLM can call to fetch
 * data on demand — the alternative would be dumping the whole DB into every
 * prompt (impossible for cost + context size). The model decides which to
 * call, in what order, with what arguments. We just expose a clean menu.
 *
 * Adding a new tool: append to `TOOLS` with the OpenAI function schema, and
 * implement the handler in `runTool`. The chat service picks both up
 * automatically.
 *
 * Design rules for tools:
 *   • Read-only — the AI Assistant should NEVER mutate Meta data without
 *     a deliberate, surfaced UI confirmation. Writes go through their own
 *     paths with audit logs.
 *   • Always filter `selectedForSync: true` — never expose accounts the
 *     user has explicitly hidden.
 *   • Return JSON-serialisable output; numbers, strings, arrays, plain
 *     objects only.
 *   • Cap result sizes (default 25 rows) — prompts are token-priced.
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { prisma } from "@/lib/db/prisma";

// ── Schemas (what the LLM sees) ─────────────────────────────────────────

export const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_today",
      description:
        "Return today's date and the standard date windows (this week / last week / this month). Call this FIRST whenever the user mentions any relative date — 'this week', 'yesterday', 'past month', etc. — to anchor the windows correctly.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_accounts",
      description:
        "List every ad account selected for sync — id, name, business, currency. Always the first lookup when the user names a brand or client. Cheap, no date arguments.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_campaigns",
      description:
        "List campaigns mirrored for one account, optionally filtered by status. Use this for 'how many campaigns', 'which campaigns are paused', 'what's the roster', etc. Does NOT include performance — call get_campaign_insights for that.",
      parameters: {
        type: "object",
        properties: {
          metaAdAccountId: {
            type: "string",
            description: "act_-prefixed ad-account id, e.g. 'act_848772841278761'",
          },
          statusFilter: {
            type: "string",
            enum: ["ACTIVE", "PAUSED", "ALL"],
            description: "Restrict to a status, or ALL for everything",
          },
        },
        required: ["metaAdAccountId", "statusFilter"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_account_insights",
      description:
        "Aggregate account-level totals for a date window. Returns spend, impressions, clicks, CTR, CPM, CPC, conversionsCount, revenueCents, ROAS (= revenue/spend), and costPerConversionCents. Use for 'how did account X perform this week', 'what's the ROAS', 'compare to last week', etc. If conversionsCount and revenueCents are both 0, the account has no conversion tracking — say so rather than guess.",
      parameters: {
        type: "object",
        properties: {
          metaAdAccountId: { type: "string", description: "act_-prefixed id" },
          dateFrom: { type: "string", description: "ISO date YYYY-MM-DD inclusive" },
          dateTo: { type: "string", description: "ISO date YYYY-MM-DD inclusive" },
        },
        required: ["metaAdAccountId", "dateFrom", "dateTo"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_campaign_insights",
      description:
        "Per-campaign metrics for one account in a date window, sorted by spend desc. Returns spend, impressions, clicks, CTR, CPM, CPC, conversionsCount, revenueCents, ROAS, and costPerConversionCents per campaign. Use for 'top campaigns by ROAS', 'which campaign is most profitable', 'campaign breakdown'. Capped at `limit` rows (default 25, max 50).",
      parameters: {
        type: "object",
        properties: {
          metaAdAccountId: { type: "string", description: "act_-prefixed id" },
          dateFrom: { type: "string", description: "ISO date YYYY-MM-DD" },
          dateTo: { type: "string", description: "ISO date YYYY-MM-DD" },
          limit: {
            type: "number",
            description: "How many campaigns to return. Default 25, max 50.",
          },
        },
        required: ["metaAdAccountId", "dateFrom", "dateTo", "limit"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_adsets_for_campaign",
      description:
        "Ad sets under one campaign with their insights for a date window. Use when the user wants to drill into a campaign — 'why is X underperforming', 'which ad set is dragging', etc.",
      parameters: {
        type: "object",
        properties: {
          metaCampaignId: { type: "string", description: "Meta campaign id" },
          dateFrom: { type: "string", description: "ISO date YYYY-MM-DD" },
          dateTo: { type: "string", description: "ISO date YYYY-MM-DD" },
        },
        required: ["metaCampaignId", "dateFrom", "dateTo"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ads_for_adset",
      description:
        "Ads under one ad set with their insights. Use for ad-level questions — 'which creative is winning', 'compare ads in adset X'.",
      parameters: {
        type: "object",
        properties: {
          metaAdSetId: { type: "string", description: "Meta ad set id" },
          dateFrom: { type: "string", description: "ISO date YYYY-MM-DD" },
          dateTo: { type: "string", description: "ISO date YYYY-MM-DD" },
        },
        required: ["metaAdSetId", "dateFrom", "dateTo"],
        additionalProperties: false,
      },
    },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function safeDiv(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

interface InsightsAgg {
  spendCents: number;
  impressions: number;
  clicks: number;
  conversionsCount: number;
  revenueCents: number;
}
function totalsFrom(rows: InsightsAgg[]) {
  let spend = 0;
  let impr = 0;
  let clicks = 0;
  let conv = 0;
  let rev = 0;
  for (const r of rows) {
    spend += r.spendCents;
    impr += r.impressions;
    clicks += r.clicks;
    conv += r.conversionsCount;
    rev += r.revenueCents;
  }
  return {
    spendCents: spend,
    impressions: impr,
    clicks,
    ctr: safeDiv(clicks, impr),
    cpmCents: Math.round(safeDiv(spend * 1000, impr)),
    cpcCents: Math.round(safeDiv(spend, clicks)),
    conversionsCount: conv,
    revenueCents: rev,
    // Derived — exposed so the LLM doesn't have to compute it.
    roas: safeDiv(rev, spend),
    costPerConversionCents: Math.round(safeDiv(spend, conv)),
  };
}

async function resolveAccount(metaAdAccountId: string) {
  const id = metaAdAccountId.startsWith("act_")
    ? metaAdAccountId
    : `act_${metaAdAccountId}`;
  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId: id, selectedForSync: true },
    select: { id: true, currency: true },
  });
  if (!account) throw new Error(`Account ${id} not found or not selected for sync`);
  return account;
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "get_today": {
      const today = todayUtc();
      const dayMs = 86_400_000;
      const yesterday = new Date(today.getTime() - dayMs);
      const thisWeekFrom = new Date(today.getTime() - 6 * dayMs);
      const lastWeekTo = new Date(thisWeekFrom.getTime() - dayMs);
      const lastWeekFrom = new Date(lastWeekTo.getTime() - 6 * dayMs);
      const monthFrom = new Date(today.getTime() - 29 * dayMs);
      return {
        today: isoDate(today),
        yesterday: isoDate(yesterday),
        thisWeek: { from: isoDate(thisWeekFrom), to: isoDate(today) },
        lastWeek: { from: isoDate(lastWeekFrom), to: isoDate(lastWeekTo) },
        last30Days: { from: isoDate(monthFrom), to: isoDate(today) },
      };
    }

    case "list_accounts": {
      const accounts = await prisma.metaAdAccount.findMany({
        where: { selectedForSync: true },
        select: {
          metaAdAccountId: true,
          name: true,
          currency: true,
          timezone: true,
          business: { select: { name: true } },
        },
        distinct: ["metaAdAccountId"],
        orderBy: [{ business: { name: "asc" } }, { name: "asc" }],
      });
      return accounts.map((a) => ({
        metaAdAccountId: a.metaAdAccountId,
        name: a.name,
        businessName: a.business.name,
        currency: a.currency,
        timezone: a.timezone,
      }));
    }

    case "get_campaigns": {
      const metaAdAccountId = String(args.metaAdAccountId ?? "");
      const statusFilter = String(args.statusFilter ?? "ALL");
      const account = await resolveAccount(metaAdAccountId);
      const where: { adAccountId: string; status?: string } = {
        adAccountId: account.id,
      };
      if (statusFilter === "ACTIVE" || statusFilter === "PAUSED") {
        where.status = statusFilter;
      }
      const campaigns = await prisma.campaign.findMany({
        where,
        select: {
          metaCampaignId: true,
          name: true,
          status: true,
          objective: true,
        },
        orderBy: { name: "asc" },
        take: 200,
      });
      const all = await prisma.campaign.findMany({
        where: { adAccountId: account.id },
        select: { status: true },
      });
      return {
        total: all.length,
        active: all.filter((c) => c.status === "ACTIVE").length,
        paused: all.filter((c) => c.status === "PAUSED").length,
        returned: campaigns.length,
        campaigns,
      };
    }

    case "get_account_insights": {
      const metaAdAccountId = String(args.metaAdAccountId ?? "");
      const dateFrom = String(args.dateFrom ?? "");
      const dateTo = String(args.dateTo ?? "");
      const account = await resolveAccount(metaAdAccountId);
      const rows = await prisma.insightsSnapshot.findMany({
        where: {
          adAccountId: account.id,
          level: "campaign",
          date: { gte: new Date(dateFrom), lte: new Date(dateTo) },
        },
        select: {
          spendCents: true,
          impressions: true,
          clicks: true,
          conversionsCount: true,
          revenueCents: true,
          date: true,
        },
      });
      const days = new Set(rows.map((r) => isoDate(r.date)));
      return {
        dateFrom,
        dateTo,
        currency: account.currency,
        daysWithData: days.size,
        ...totalsFrom(rows),
      };
    }

    case "get_campaign_insights": {
      const metaAdAccountId = String(args.metaAdAccountId ?? "");
      const dateFrom = String(args.dateFrom ?? "");
      const dateTo = String(args.dateTo ?? "");
      const limit = Math.max(
        1,
        Math.min(50, Number(args.limit ?? 25)),
      );
      const account = await resolveAccount(metaAdAccountId);
      const rows = await prisma.insightsSnapshot.findMany({
        where: {
          adAccountId: account.id,
          level: "campaign",
          date: { gte: new Date(dateFrom), lte: new Date(dateTo) },
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
      const byCamp = new Map<string, InsightsAgg>();
      for (const r of rows) {
        const cur = byCamp.get(r.entityId) ?? {
          spendCents: 0,
          impressions: 0,
          clicks: 0,
          conversionsCount: 0,
          revenueCents: 0,
        };
        cur.spendCents += r.spendCents;
        cur.impressions += r.impressions;
        cur.clicks += r.clicks;
        cur.conversionsCount += r.conversionsCount;
        cur.revenueCents += r.revenueCents;
        byCamp.set(r.entityId, cur);
      }
      const ids = Array.from(byCamp.keys());
      const campaigns =
        ids.length > 0
          ? await prisma.campaign.findMany({
              where: {
                adAccountId: account.id,
                metaCampaignId: { in: ids },
              },
              select: {
                metaCampaignId: true,
                name: true,
                status: true,
              },
            })
          : [];
      const meta = new Map(campaigns.map((c) => [c.metaCampaignId, c]));
      return ids
        .map((id) => {
          const agg = byCamp.get(id)!;
          const m = meta.get(id);
          return {
            metaCampaignId: id,
            name: m?.name ?? id,
            status: m?.status ?? "UNKNOWN",
            spendCents: agg.spendCents,
            impressions: agg.impressions,
            clicks: agg.clicks,
            ctr: safeDiv(agg.clicks, agg.impressions),
            cpmCents: Math.round(safeDiv(agg.spendCents * 1000, agg.impressions)),
            cpcCents: Math.round(safeDiv(agg.spendCents, agg.clicks)),
            conversionsCount: agg.conversionsCount,
            revenueCents: agg.revenueCents,
            roas: safeDiv(agg.revenueCents, agg.spendCents),
            costPerConversionCents: Math.round(
              safeDiv(agg.spendCents, agg.conversionsCount),
            ),
          };
        })
        .sort((a, b) => b.spendCents - a.spendCents)
        .slice(0, limit);
    }

    case "get_adsets_for_campaign": {
      const metaCampaignId = String(args.metaCampaignId ?? "");
      const dateFrom = String(args.dateFrom ?? "");
      const dateTo = String(args.dateTo ?? "");
      const campaign = await prisma.campaign.findFirst({
        where: {
          metaCampaignId,
          adAccount: { selectedForSync: true },
        },
        select: { id: true, adAccountId: true },
      });
      if (!campaign) throw new Error(`Campaign ${metaCampaignId} not found`);
      const adSets = await prisma.adSet.findMany({
        where: { campaignId: campaign.id },
        select: { metaAdSetId: true, name: true, status: true },
      });
      const adSetIds = adSets.map((a) => a.metaAdSetId);
      const rows = await prisma.insightsSnapshot.findMany({
        where: {
          adAccountId: campaign.adAccountId,
          level: "adset",
          entityId: { in: adSetIds },
          date: { gte: new Date(dateFrom), lte: new Date(dateTo) },
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
      const byAdSet = new Map<string, InsightsAgg>();
      for (const r of rows) {
        const cur = byAdSet.get(r.entityId) ?? {
          spendCents: 0,
          impressions: 0,
          clicks: 0,
          conversionsCount: 0,
          revenueCents: 0,
        };
        cur.spendCents += r.spendCents;
        cur.impressions += r.impressions;
        cur.clicks += r.clicks;
        cur.conversionsCount += r.conversionsCount;
        cur.revenueCents += r.revenueCents;
        byAdSet.set(r.entityId, cur);
      }
      return adSets
        .map((a) => {
          const agg = byAdSet.get(a.metaAdSetId) ?? {
            spendCents: 0,
            impressions: 0,
            clicks: 0,
            conversionsCount: 0,
            revenueCents: 0,
          };
          return {
            metaAdSetId: a.metaAdSetId,
            name: a.name,
            status: a.status,
            spendCents: agg.spendCents,
            impressions: agg.impressions,
            clicks: agg.clicks,
            ctr: safeDiv(agg.clicks, agg.impressions),
            conversionsCount: agg.conversionsCount,
            revenueCents: agg.revenueCents,
            roas: safeDiv(agg.revenueCents, agg.spendCents),
          };
        })
        .sort((a, b) => b.spendCents - a.spendCents);
    }

    case "get_ads_for_adset": {
      const metaAdSetId = String(args.metaAdSetId ?? "");
      const dateFrom = String(args.dateFrom ?? "");
      const dateTo = String(args.dateTo ?? "");
      const adSet = await prisma.adSet.findFirst({
        where: {
          metaAdSetId,
          adAccount: { selectedForSync: true },
        },
        select: { id: true, adAccountId: true },
      });
      if (!adSet) throw new Error(`Ad set ${metaAdSetId} not found`);
      const ads = await prisma.ad.findMany({
        where: { adSetId: adSet.id },
        select: {
          metaAdId: true,
          name: true,
          status: true,
          format: true,
        },
      });
      const adIds = ads.map((a) => a.metaAdId);
      const rows = await prisma.insightsSnapshot.findMany({
        where: {
          adAccountId: adSet.adAccountId,
          level: "ad",
          entityId: { in: adIds },
          date: { gte: new Date(dateFrom), lte: new Date(dateTo) },
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
      const byAd = new Map<string, InsightsAgg>();
      for (const r of rows) {
        const cur = byAd.get(r.entityId) ?? {
          spendCents: 0,
          impressions: 0,
          clicks: 0,
          conversionsCount: 0,
          revenueCents: 0,
        };
        cur.spendCents += r.spendCents;
        cur.impressions += r.impressions;
        cur.clicks += r.clicks;
        cur.conversionsCount += r.conversionsCount;
        cur.revenueCents += r.revenueCents;
        byAd.set(r.entityId, cur);
      }
      return ads
        .map((a) => {
          const agg = byAd.get(a.metaAdId) ?? {
            spendCents: 0,
            impressions: 0,
            clicks: 0,
            conversionsCount: 0,
            revenueCents: 0,
          };
          return {
            metaAdId: a.metaAdId,
            name: a.name,
            status: a.status,
            format: a.format,
            spendCents: agg.spendCents,
            impressions: agg.impressions,
            clicks: agg.clicks,
            ctr: safeDiv(agg.clicks, agg.impressions),
            conversionsCount: agg.conversionsCount,
            revenueCents: agg.revenueCents,
            roas: safeDiv(agg.revenueCents, agg.spendCents),
          };
        })
        .sort((a, b) => b.spendCents - a.spendCents);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
