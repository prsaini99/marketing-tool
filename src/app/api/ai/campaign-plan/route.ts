/**
 * POST /api/ai/campaign-plan
 *
 * Body: { adAccountId: string, brief: string, priorPlan?: CampaignPlan,
 *         maxDailySpendCents?: number }
 *
 * Produces a validated CampaignPlan from a natural-language brief. Read-only
 * by construction: this route reads the local mirror, calls the model, and
 * returns an object. It creates nothing on Meta and persists nothing.
 *
 * THIS ROUTE MUST NEVER EXECUTE A PLAN. Execution is a separate, explicitly
 * approved action against a plan a human has seen in full. Keeping the two
 * on different routes is what stops "generate" from quietly becoming
 * "generate and launch" the first time someone adds a convenience flag.
 *
 * `maxDailySpendCents` raises the plan-wide spend ceiling. It is accepted
 * here so a buyer can deliberately plan something large, and it is bounded
 * below by nothing and above by the caller's own judgement, which is the
 * point: the ceiling exists to stop a model slipping a decimal, not to stop
 * a person spending their own budget.
 */

import { NextResponse } from "next/server";
import { planCampaign } from "@/server/services/ai/plan-campaign";
import type { CampaignPlan } from "@/lib/campaign-plan";

export const maxDuration = 180;

export async function POST(req: Request) {
  let body: {
    adAccountId?: unknown;
    brief?: unknown;
    priorPlan?: unknown;
    maxDailySpendCents?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.adAccountId !== "string" || !body.adAccountId) {
    return NextResponse.json(
      { error: "adAccountId is required" },
      { status: 400 },
    );
  }
  if (typeof body.brief !== "string" || !body.brief.trim()) {
    return NextResponse.json({ error: "brief is required" }, { status: 400 });
  }
  if (
    body.maxDailySpendCents !== undefined &&
    (typeof body.maxDailySpendCents !== "number" ||
      !Number.isFinite(body.maxDailySpendCents) ||
      body.maxDailySpendCents <= 0)
  ) {
    return NextResponse.json(
      { error: "maxDailySpendCents must be a positive number" },
      { status: 400 },
    );
  }

  try {
    const result = await planCampaign({
      adAccountId: body.adAccountId,
      brief: body.brief.trim(),
      priorPlan: (body.priorPlan as CampaignPlan | undefined) ?? undefined,
      maxDailySpendCents: body.maxDailySpendCents as number | undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Plan generation failed";
    console.error("[campaign-plan]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
