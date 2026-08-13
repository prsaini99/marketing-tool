/**
 * POST /api/ai/improve-ad
 *
 * Body: { metaAdId: string, count?: number }
 *
 * Diagnoses an ad from its own insights, rewrites it grounded in the
 * account's winners, and pre-flights the result. READ-ONLY — nothing is
 * written to Meta or Postgres. Applying a rewrite is a separate, explicitly
 * confirmed action through the create-ad flow.
 */

import { NextResponse } from "next/server";
import { improveAd } from "@/server/services/ai/improve-ad";

// Copy generation plus a pre-flight (which is itself three concurrent
// calls). Comfortably over the default cap.
export const maxDuration = 180;

export async function POST(req: Request) {
  let body: { metaAdId?: unknown; count?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.metaAdId !== "string" || !body.metaAdId) {
    return NextResponse.json({ error: "metaAdId is required" }, { status: 400 });
  }

  const count = Number(body.count);
  try {
    const result = await improveAd(body.metaAdId, {
      count: Number.isFinite(count) ? count : undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to improve ad";
    return NextResponse.json(
      { error: message },
      { status: /not found/i.test(message) ? 404 : 500 },
    );
  }
}
