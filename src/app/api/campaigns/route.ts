/**
 * POST /api/campaigns
 *
 * Creates a new campaign on Meta and mirrors it locally. See
 * src/server/services/campaigns/create.ts for the audit + insert flow.
 *
 * Body shape:
 *   {
 *     metaAdAccountId: "act_1234",
 *     name: string,
 *     objective: string,              // OUTCOME_*
 *     status: "PAUSED" | "ACTIVE",
 *     specialAdCategories: string[],  // empty array = "None"
 *     budgetType: "daily" | "lifetime" | null,
 *     budgetCents?: number,
 *     bidStrategy?: string,           // LOWEST_COST_WITHOUT_CAP etc.
 *     spendCapCents?: number,
 *     stopTime?: string               // ISO 8601, required for lifetime
 *   }
 */

import { NextResponse } from "next/server";
import { createCampaign } from "@/server/services/campaigns/create";

interface Body {
  metaAdAccountId?: unknown;
  name?: unknown;
  objective?: unknown;
  status?: unknown;
  specialAdCategories?: unknown;
  budgetType?: unknown;
  budgetCents?: unknown;
  bidStrategy?: unknown;
  spendCapCents?: unknown;
  stopTime?: unknown;
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
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (typeof body.objective !== "string" || !body.objective) {
    return NextResponse.json(
      { error: "objective is required" },
      { status: 400 },
    );
  }
  if (body.status !== "PAUSED" && body.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "status must be 'PAUSED' or 'ACTIVE'" },
      { status: 400 },
    );
  }
  if (
    !Array.isArray(body.specialAdCategories) ||
    !body.specialAdCategories.every((c): c is string => typeof c === "string")
  ) {
    return NextResponse.json(
      { error: "specialAdCategories must be a string[]" },
      { status: 400 },
    );
  }
  const budgetType =
    body.budgetType === "daily" || body.budgetType === "lifetime"
      ? body.budgetType
      : null;
  if (
    budgetType &&
    (typeof body.budgetCents !== "number" || body.budgetCents <= 0)
  ) {
    return NextResponse.json(
      { error: "budgetCents must be a positive number when budgetType is set" },
      { status: 400 },
    );
  }
  if (budgetType === "lifetime" && typeof body.stopTime !== "string") {
    return NextResponse.json(
      { error: "stopTime is required for lifetime budgets" },
      { status: 400 },
    );
  }

  try {
    const result = await createCampaign({
      metaAdAccountId: body.metaAdAccountId,
      name: body.name,
      objective: body.objective,
      status: body.status,
      specialAdCategories: body.specialAdCategories,
      budgetType,
      budgetCents:
        typeof body.budgetCents === "number" ? body.budgetCents : undefined,
      bidStrategy:
        typeof body.bidStrategy === "string" ? body.bidStrategy : undefined,
      spendCapCents:
        typeof body.spendCapCents === "number" ? body.spendCapCents : undefined,
      stopTime:
        typeof body.stopTime === "string" ? body.stopTime : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("create campaign error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
