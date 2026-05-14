/**
 * GET /api/campaigns/export.csv?client=<businessId>&range=7d
 *
 * Streams a cross-account CSV of campaigns. `client` is optional — when
 * present, scopes to one Business Manager (the top-bar switcher); when
 * absent, exports every campaign across every selected ad account.
 *
 * Spend / impressions / clicks / CTR are aggregated over the requested window.
 *
 * Strictly read-only — pulls from local Postgres, doesn't touch Meta.
 */

import { prisma } from "@/lib/db/prisma";
import { resolveDateRange } from "@/lib/date-range";

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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dateRange = resolveDateRange(url.searchParams.get("range"));
  const clientId = url.searchParams.get("client");

  const selectedBusiness = clientId
    ? await prisma.metaBusiness.findUnique({
        where: { id: clientId },
        select: { id: true, name: true },
      })
    : null;

  const campaigns = await prisma.campaign.findMany({
    where: {
      adAccount: {
        selectedForSync: true,
        ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
      },
    },
    include: {
      adAccount: {
        select: {
          metaAdAccountId: true,
          name: true,
          currency: true,
          business: { select: { name: true } },
        },
      },
    },
    orderBy: [{ adAccount: { name: "asc" } }, { name: "asc" }],
  });

  // Pull campaign-level insights for the same scope in one query, then bucket
  // by (adAccountInternalId, metaCampaignId) so each row gets the right metrics.
  const dateFilter = dateRange.since ? { date: { gte: dateRange.since } } : {};
  const perCampaign = await prisma.insightsSnapshot.groupBy({
    by: ["adAccountId", "entityId"],
    where: {
      level: "campaign",
      adAccount: {
        selectedForSync: true,
        ...(selectedBusiness ? { businessId: selectedBusiness.id } : {}),
      },
      ...dateFilter,
    },
    _sum: { spendCents: true, impressions: true, clicks: true },
  });

  const metricsKey = (adAccountInternalId: string, metaCampaignId: string) =>
    `${adAccountInternalId}::${metaCampaignId}`;

  // adAccountId here is the Prisma row id, NOT the act_-prefixed Meta id.
  const metricsByCampaign = new Map(
    perCampaign.map((m) => [
      metricsKey(m.adAccountId, m.entityId),
      {
        spendCents: m._sum.spendCents ?? 0,
        impressions: m._sum.impressions ?? 0,
        clicks: m._sum.clicks ?? 0,
      },
    ]),
  );

  const headers = [
    "business_name",
    "ad_account_name",
    "meta_ad_account_id",
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
    const m = metricsByCampaign.get(metricsKey(c.adAccountId, c.metaCampaignId));
    const impressions = m?.impressions ?? 0;
    const clicks = m?.clicks ?? 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const spend = (m?.spendCents ?? 0) / 100;
    return [
      c.adAccount.business.name,
      c.adAccount.name,
      c.adAccount.metaAdAccountId,
      c.metaCampaignId,
      c.name,
      c.status,
      c.objective ?? "",
      c.dailyBudgetCents ?? "",
      c.lifetimeBudgetCents ?? "",
      c.adAccount.currency,
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

  const dateSlug = new Date().toISOString().slice(0, 10);
  const scopeSlug = selectedBusiness
    ? sanitizeFilenameSegment(selectedBusiness.name)
    : "all-clients";
  const filename = `campaigns-${scopeSlug}-${dateRange.value}-${dateSlug}.csv`;

  // BOM for Excel UTF-8 compatibility (same as the old account-scoped route).
  return new Response("﻿" + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
