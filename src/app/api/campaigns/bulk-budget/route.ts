/**
 * POST /api/campaigns/bulk-budget
 *
 * Body:
 *   {
 *     metaCampaignIds: string[],
 *     budgetType: "daily" | "lifetime",
 *     setAbsoluteCents?: number,  // either this...
 *     adjustPercent?: number,     // ...or this (exactly one)
 *   }
 *
 * See bulk-budget.ts for the per-campaign flow + audit-log details.
 */

import { NextResponse } from "next/server";
import {
  bulkUpdateCampaignBudget,
  type BudgetType,
} from "@/server/services/campaigns/bulk-budget";

interface Body {
  metaCampaignIds?: unknown;
  budgetType?: unknown;
  setAbsoluteCents?: unknown;
  adjustPercent?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = Array.isArray(body.metaCampaignIds)
    ? body.metaCampaignIds.filter((x): x is string => typeof x === "string")
    : null;
  if (!ids || ids.length === 0) {
    return NextResponse.json(
      { error: "metaCampaignIds must be a non-empty array of strings" },
      { status: 400 },
    );
  }

  const budgetType = body.budgetType as BudgetType;
  if (budgetType !== "daily" && budgetType !== "lifetime") {
    return NextResponse.json(
      { error: "budgetType must be 'daily' or 'lifetime'" },
      { status: 400 },
    );
  }

  const setAbsolute =
    typeof body.setAbsoluteCents === "number" ? body.setAbsoluteCents : undefined;
  const adjustPct =
    typeof body.adjustPercent === "number" ? body.adjustPercent : undefined;

  try {
    const result = await bulkUpdateCampaignBudget({
      metaCampaignIds: ids,
      budgetType,
      setAbsoluteCents: setAbsolute,
      adjustPercent: adjustPct,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("bulk-budget error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
