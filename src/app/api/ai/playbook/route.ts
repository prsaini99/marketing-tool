/**
 * GET /api/ai/playbook
 *
 * Browse the cross-portfolio "winners" library — the proactive view of
 * what's working across every account in the agency. Powers the
 * /dashboard/playbook page.
 *
 * Query params:
 *   client?    — businessId; narrows to one client's accounts
 *   q?         — semantic search; when present, ranks by similarity × perf
 *   metric?    — "roas" (default) | "conversions" | "ctr" | "spend"; how
 *                to sort when q is absent
 *   limit?     — default 20, max 50
 *
 * Returns: { entries: PlaybookEntry[], totalScanned, stats }
 *
 * Filters out anything with no real performance signal (spend < ₹500 AND
 * no conversions) — same gate as the in-modal cross-account winners
 * search. The point is *winners*, not "any indexed copy".
 */

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { searchCrossAccountWinners } from "@/server/services/rag";

const SPEND_FLOOR_CENTS = 500 * 100;

interface AccountRef {
  name: string;
  metaAdAccountId: string;
  business: { id: string; name: string };
}

interface PlaybookEntry {
  id: string;
  sourceId: string;
  content: string;
  callToActionType: string | null;
  perf: {
    spendCents: number;
    revenueCents: number;
    conversionsCount: number;
    ctr: number;
    roas: number;
  };
  account: AccountRef | null;
}

type Metric = "roas" | "conversions" | "ctr" | "spend";

function parseMetric(v: string | null): Metric {
  if (v === "conversions" || v === "ctr" || v === "spend") return v;
  return "roas";
}

interface RawRow {
  id: string;
  sourceId: string;
  content: string;
  adAccountId: string | null;
  metadata: Record<string, unknown>;
  // Only present on the semantic-search path
  distance?: number;
}

async function browseByMetric(
  metric: Metric,
  businessId: string | null,
  limit: number,
): Promise<RawRow[]> {
  // Order key chosen so the index falls back gracefully on null perf.
  const orderKey =
    metric === "conversions"
      ? "conversionsCount"
      : metric === "ctr"
        ? "ctr"
        : metric === "spend"
          ? "spendCents"
          : "roas";

  // Build dynamic SQL — Prisma.sql keeps params escaped.
  const conds: Prisma.Sql[] = [
    Prisma.sql`namespace = 'ads'`,
    // Same perf gate as the in-modal winners search.
    Prisma.sql`((metadata->>'spendCents')::int >= ${SPEND_FLOOR_CENTS} OR (metadata->>'conversionsCount')::int > 0)`,
  ];
  if (businessId) {
    conds.push(Prisma.sql`"businessId" = ${businessId}`);
  }
  const where = Prisma.join(conds, " AND ");

  return prisma.$queryRaw<RawRow[]>`
    SELECT
      id,
      "sourceId",
      content,
      "adAccountId",
      metadata
    FROM "Embedding"
    WHERE ${where}
    ORDER BY (metadata->>${orderKey})::float DESC NULLS LAST
    LIMIT ${limit}
  `;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const client = url.searchParams.get("client");
  const q = url.searchParams.get("q")?.trim() || null;
  const metric = parseMetric(url.searchParams.get("metric"));
  const limitRaw = Number(url.searchParams.get("limit") ?? 20);
  const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 20));

  let businessId: string | null = null;
  if (client) {
    const biz = await prisma.metaBusiness.findUnique({
      where: { id: client },
      select: { id: true },
    });
    if (!biz) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 },
      );
    }
    businessId = biz.id;
  }

  try {
    let rows: RawRow[];

    if (q) {
      // Semantic path: similarity × performance multiplier. We use the
      // existing helper but pass a sentinel excludeAdAccountId so nothing
      // is filtered out — Playbook is "the whole portfolio".
      const hits = await searchCrossAccountWinners({
        query: q,
        namespace: "ads",
        excludeAdAccountId: "_playbook_no_exclude_",
        initialK: 50,
        finalK: limit * 2, // overshoot, filter by businessId after
      });
      // Need adAccountId from the raw embedding rows; fetch by hit ids.
      const idSet = hits.map((h) => h.id);
      const dbRows = idSet.length
        ? await prisma.$queryRaw<RawRow[]>`
            SELECT id, "sourceId", content, "adAccountId", metadata
            FROM "Embedding"
            WHERE id = ANY(${idSet})
          `
        : [];
      const byId = new Map(dbRows.map((r) => [r.id, r]));
      rows = [];
      for (const h of hits) {
        const r = byId.get(h.id);
        if (!r) continue;
        if (businessId) {
          // Filter by business — fetched once below
        }
        rows.push({ ...r, distance: h.distance });
        if (rows.length >= limit * 2) break;
      }
    } else {
      rows = await browseByMetric(metric, businessId, limit);
    }

    // Resolve account info in one batch.
    const acctIds = Array.from(
      new Set(rows.map((r) => r.adAccountId).filter((x): x is string => !!x)),
    );
    const accounts = acctIds.length
      ? await prisma.metaAdAccount.findMany({
          where: { id: { in: acctIds } },
          select: {
            id: true,
            name: true,
            metaAdAccountId: true,
            businessId: true,
            business: { select: { id: true, name: true } },
          },
        })
      : [];
    const acctById = new Map(accounts.map((a) => [a.id, a]));

    let entries: PlaybookEntry[] = rows
      .map((r) => {
        const acct = r.adAccountId ? acctById.get(r.adAccountId) : null;
        // Drop entries whose account got dropped (cascade) or filtered out.
        if (r.adAccountId && !acct) return null;
        // When q is present and a businessId filter was applied, the
        // browse-path already had it; for the semantic path, filter here.
        if (q && businessId && acct?.businessId !== businessId) return null;
        const md = r.metadata ?? {};
        const perf = {
          spendCents: Number(md.spendCents ?? 0),
          revenueCents: Number(md.revenueCents ?? 0),
          conversionsCount: Number(md.conversionsCount ?? 0),
          ctr: Number(md.ctr ?? 0),
          roas: Number(md.roas ?? 0),
        };
        return {
          id: r.id,
          sourceId: r.sourceId,
          content: r.content,
          callToActionType:
            typeof md.callToActionType === "string"
              ? md.callToActionType
              : null,
          perf,
          account: acct
            ? {
                name: acct.name,
                metaAdAccountId: acct.metaAdAccountId,
                business: acct.business,
              }
            : null,
        };
      })
      .filter((x): x is PlaybookEntry => x !== null);

    // For the semantic path, we overshot by 2× — trim to the requested limit
    // after filters.
    if (q) entries = entries.slice(0, limit);

    // Lightweight stats panel.
    const accountsSeen = new Set(
      entries.map((e) => e.account?.metaAdAccountId).filter(Boolean),
    );
    const roases = entries
      .map((e) => e.perf.roas)
      .filter((r) => r > 0);
    const avgRoas =
      roases.length > 0 ? roases.reduce((a, b) => a + b, 0) / roases.length : 0;

    return NextResponse.json({
      entries,
      totalScanned: rows.length,
      stats: {
        accountsRepresented: accountsSeen.size,
        avgRoas,
      },
    });
  } catch (err) {
    console.error("playbook error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
