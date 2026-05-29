/**
 * POST /api/reach-estimate
 *
 * Live wrapper around Meta's /act_X/delivery_estimate. The Create Ad Set
 * modal calls this with the targeting spec it would otherwise POST to
 * /adsets — we route the request through the encrypted connection token
 * for the account so the browser never touches Meta directly.
 *
 * Body:
 *   {
 *     metaAdAccountId: "act_..." | "...",       // unprefixed or prefixed
 *     targeting: { geo_locations: {...}, ... }, // Meta-shape targeting
 *     optimizationGoal: "LINK_CLICKS" | ...,
 *   }
 *
 * Returns: { lowerBound, upperBound, ready }
 *
 * This is a GET-style read, but POST is used to keep the targeting JSON in
 * the body (URLs cap out at ~2KB on some browsers and targeting specs can
 * exceed that with many custom audiences).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

interface Body {
  metaAdAccountId?: unknown;
  targeting?: unknown;
  optimizationGoal?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body.metaAdAccountId !== "string" ||
    !body.metaAdAccountId.trim()
  ) {
    return NextResponse.json(
      { error: "metaAdAccountId is required" },
      { status: 400 },
    );
  }
  if (!body.targeting || typeof body.targeting !== "object") {
    return NextResponse.json(
      { error: "targeting must be an object" },
      { status: 400 },
    );
  }
  if (
    typeof body.optimizationGoal !== "string" ||
    !body.optimizationGoal
  ) {
    return NextResponse.json(
      { error: "optimizationGoal is required" },
      { status: 400 },
    );
  }

  const metaAdAccountId = body.metaAdAccountId.startsWith("act_")
    ? body.metaAdAccountId
    : `act_${body.metaAdAccountId}`;

  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId, selectedForSync: true },
    select: {
      metaAdAccountId: true,
      business: { select: { connectionId: true } },
    },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Ad account not found or not selected for sync" },
      { status: 404 },
    );
  }

  try {
    const estimate = await metaClient.getDeliveryEstimate(
      account.business.connectionId,
      account.metaAdAccountId,
      body.targeting as Record<string, unknown>,
      body.optimizationGoal,
    );
    return NextResponse.json(estimate);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("reach-estimate error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
