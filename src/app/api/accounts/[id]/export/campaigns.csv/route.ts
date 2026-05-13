/**
 * GET /api/accounts/[id]/export/campaigns.csv?range=7d
 *
 * Streams a CSV download of campaigns for one ad account, with the per-campaign
 * spend / impressions / clicks / CTR aggregated over the requested window.
 *
 * Strictly read-only — pulls from local Postgres, doesn't touch Meta.
 */

import { prisma } from "@/lib/db/prisma";
import { resolveDateRange } from "@/lib/date-range";

// CSV cell encoder — quotes the value when it contains commas, quotes, or
// newlines (RFC 4180). Quotes inside the value are doubled.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function sanitizeFilenameSegment(s: string): string {
  return s.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "");
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const dateRange = resolveDateRange(url.searchParams.get("range"));
  const fullAccountId = `act_${id}`;

  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId: fullAccountId, selectedForSync: true },
    include: { business: true },
  });
  if (!account) {
    return new Response("Ad account not found or not selected for sync", {
      status: 404,
    });
  }

  const dateFilter = dateRange.since ? { date: { gte: dateRange.since } } : {};

  const [campaigns, perCampaign] = await Promise.all([
    prisma.campaign.findMany({
      where: { adAccountId: account.id },
      orderBy: { name: "asc" },
    }),
    prisma.insightsSnapshot.groupBy({
      by: ["entityId"],
      where: {
        adAccountId: account.id,
        level: "campaign",
        ...dateFilter,
      },
      _sum: { spendCents: true, impressions: true, clicks: true },
    }),
  ]);

  const metricsByCampaign = new Map(
    perCampaign.map((m) => [
      m.entityId,
      {
        spendCents: m._sum.spendCents ?? 0,
        impressions: m._sum.impressions ?? 0,
        clicks: m._sum.clicks ?? 0,
      },
    ]),
  );

  const headers = [
    "meta_campaign_id",
    "name",
    "status",
    "objective",
    "daily_budget_cents",
    "lifetime_budget_cents",
    "currency",
    `spend_${dateRange.value}`,
    `impressions_${dateRange.value}`,
    `clicks_${dateRange.value}`,
    `ctr_${dateRange.value}_pct`,
    "last_edited_at",
    "synced_at",
  ];

  const rows = campaigns.map((c) => {
    const m = metricsByCampaign.get(c.metaCampaignId);
    const impressions = m?.impressions ?? 0;
    const clicks = m?.clicks ?? 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const spend = (m?.spendCents ?? 0) / 100;
    return [
      c.metaCampaignId,
      c.name,
      c.status,
      c.objective ?? "",
      c.dailyBudgetCents ?? "",
      c.lifetimeBudgetCents ?? "",
      account.currency,
      spend.toFixed(2),
      impressions,
      clicks,
      (ctr * 100).toFixed(4),
      c.metaUpdatedTime?.toISOString() ?? "",
      c.syncedAt.toISOString(),
    ];
  });

  const csv =
    headers.join(",") +
    "\n" +
    rows.map((r) => r.map(csvCell).join(",")).join("\n") +
    "\n";

  // YYYY-MM-DD for the filename — clean for archiving multiple exports.
  const dateSlug = new Date().toISOString().slice(0, 10);
  const filename = `${sanitizeFilenameSegment(account.name)}-campaigns-${dateRange.value}-${dateSlug}.csv`;

  // BOM helps Excel open UTF-8 CSVs correctly. Tradeoff: it confuses some
  // strict parsers; for Excel users (likely audience) it's the right call.
  return new Response("﻿" + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
