/**
 * GET /api/cron/rules
 *
 * Evaluates every enabled ad rule and executes the ones that fire. This is
 * the only scheduled endpoint in the codebase that MUTATES a client's ads,
 * so two things are deliberate:
 *
 * 1. It is a SEPARATE cron from the sync tick. Rules must be evaluated on a
 *    known cadence with a known blast radius; folding them into the tick
 *    would couple "did the sync run?" to "did we pause a campaign?" and make
 *    both harder to reason about after the fact.
 *
 * 2. It runs AFTER insights would normally have synced (see vercel.json).
 *    Evaluating before the day's data lands is how you pause a campaign for
 *    a collapse that is really just a missing sync — which the engine's
 *    insufficient-data guard also defends against, but scheduling it
 *    correctly means that guard is a backstop rather than the primary
 *    defence.
 *
 * Auth: optional CRON_SECRET bearer, matching the other cron routes.
 */

import { NextResponse } from "next/server";
import { runAllRules } from "@/server/services/rules/evaluate";
import { requireCronAuth } from "@/lib/cron-auth";

export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const report = await runAllRules({ execute: true });
    return NextResponse.json(report);
  } catch (err) {
    console.error("cron rules error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
