/**
 * GET /api/rules/entities?adAccountId=&scope=
 *
 * The pick-list for scoping a rule to specific entities: campaigns, ad sets
 * or ads of one account, from the local mirror (never a live Meta call — a
 * form dropdown must not spend rate limit).
 *
 * Active entities sort first: a rule is almost always written about
 * something currently running, and burying the running campaign under forty
 * archived ones is how a picker stops being used.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { RuleScope } from "@/lib/ad-rules";

const SCOPES: RuleScope[] = ["campaign", "adset", "ad"];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const adAccountId = searchParams.get("adAccountId");
  const scope = searchParams.get("scope") as RuleScope | null;

  if (!adAccountId) {
    return NextResponse.json({ error: "adAccountId is required" }, { status: 400 });
  }
  if (!scope || !SCOPES.includes(scope)) {
    return NextResponse.json(
      { error: `scope must be one of ${SCOPES.join(", ")}` },
      { status: 400 },
    );
  }

  let entities: Array<{ id: string; name: string; status: string }>;
  if (scope === "campaign") {
    entities = (
      await prisma.campaign.findMany({
        where: { adAccountId },
        select: { metaCampaignId: true, name: true, status: true },
        take: 200,
      })
    ).map((c) => ({ id: c.metaCampaignId, name: c.name, status: c.status }));
  } else if (scope === "adset") {
    entities = (
      await prisma.adSet.findMany({
        where: { adAccountId },
        select: { metaAdSetId: true, name: true, status: true },
        take: 200,
      })
    ).map((a) => ({ id: a.metaAdSetId, name: a.name, status: a.status }));
  } else {
    entities = (
      await prisma.ad.findMany({
        where: { adAccountId },
        select: { metaAdId: true, name: true, status: true },
        take: 200,
      })
    ).map((a) => ({ id: a.metaAdId, name: a.name, status: a.status }));
  }

  entities.sort((a, b) => {
    const aActive = a.status === "ACTIVE" ? 0 : 1;
    const bActive = b.status === "ACTIVE" ? 0 : 1;
    return aActive - bActive || a.name.localeCompare(b.name);
  });

  return NextResponse.json({ entities });
}
