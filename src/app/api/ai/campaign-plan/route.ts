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
import { runCopilot } from "@/server/services/ai/copilot-agent";
import type { CampaignPlan } from "@/lib/campaign-plan";

export const maxDuration = 180;

/** Tolerant coercion: a missing or malformed pin list means "nothing pinned". */
function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.length > 0);
  return out.length ? out : undefined;
}

export async function POST(req: Request) {
  let body: {
    adAccountId?: unknown;
    brief?: unknown;
    priorPlan?: unknown;
    maxDailySpendCents?: unknown;
    pinnedImageHashes?: unknown;
    pinnedVideoIds?: unknown;
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
    const result = await runCopilot({
      adAccountId: body.adAccountId,
      brief: body.brief.trim(),
      priorPlan: (body.priorPlan as CampaignPlan | undefined) ?? undefined,
      maxDailySpendCents: body.maxDailySpendCents as number | undefined,
      pinnedImageHashes: asStringArray(body.pinnedImageHashes),
      pinnedVideoIds: asStringArray(body.pinnedVideoIds),
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Plan generation failed";
    console.error("[campaign-plan]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
