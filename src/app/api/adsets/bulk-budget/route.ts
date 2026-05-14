/**
 * POST /api/adsets/bulk-budget
 * Body: { metaAdSetIds: string[], budgetType: "daily"|"lifetime", setAbsoluteCents? | adjustPercent? }
 */

import { NextResponse } from "next/server";
import {
  bulkUpdateAdSetBudget,
  type BudgetType,
} from "@/server/services/adsets/bulk-budget";

interface Body {
  metaAdSetIds?: unknown;
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

  const ids = Array.isArray(body.metaAdSetIds)
    ? body.metaAdSetIds.filter((x): x is string => typeof x === "string")
    : null;
  if (!ids || ids.length === 0) {
    return NextResponse.json(
      { error: "metaAdSetIds must be a non-empty array of strings" },
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
    const result = await bulkUpdateAdSetBudget({
      metaAdSetIds: ids,
      budgetType,
      setAbsoluteCents: setAbsolute,
      adjustPercent: adjustPct,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("adsets bulk-budget error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
