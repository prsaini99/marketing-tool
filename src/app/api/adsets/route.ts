/**
 * POST /api/adsets
 *
 * Creates an ad set on Meta + mirrors it locally. See
 * src/server/services/adsets/create.ts for the audit + insert flow.
 *
 * Body shape:
 *   {
 *     metaCampaignId: string,
 *     name: string,
 *     status: "PAUSED" | "ACTIVE",
 *     optimizationGoal: string,
 *     billingEvent?: string,         // defaults "IMPRESSIONS"
 *     budgetType: "daily" | "lifetime" | null,
 *     budgetCents?: number,
 *     startTime?: string,            // ISO 8601
 *     endTime?: string,              // ISO 8601, required for lifetime
 *     targeting: {
 *       countries: string[],
 *       ageMin: number,
 *       ageMax: number,
 *       genders: number[] | null,    // null = all, [1] = M, [2] = F
 *       placements: {                // null = automatic placements
 *         facebookPositions?: string[],
 *         instagramPositions?: string[],
 *       } | null,
 *     }
 *   }
 */

import { NextResponse } from "next/server";
import { createAdSet } from "@/server/services/adsets/create";

interface Body {
  metaCampaignId?: unknown;
  name?: unknown;
  status?: unknown;
  optimizationGoal?: unknown;
  billingEvent?: unknown;
  budgetType?: unknown;
  budgetCents?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  targeting?: unknown;
  promotedObject?: unknown;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number");
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.metaCampaignId !== "string" || !body.metaCampaignId.trim()) {
    return NextResponse.json(
      { error: "metaCampaignId is required" },
      { status: 400 },
    );
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (body.status !== "PAUSED" && body.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "status must be 'PAUSED' or 'ACTIVE'" },
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
  if (budgetType === "lifetime" && typeof body.endTime !== "string") {
    return NextResponse.json(
      { error: "endTime is required for lifetime budgets" },
      { status: 400 },
    );
  }

  const targeting = body.targeting;
  if (!targeting || typeof targeting !== "object") {
    return NextResponse.json(
      { error: "targeting must be an object" },
      { status: 400 },
    );
  }
  const t = targeting as Record<string, unknown>;
  if (!isStringArray(t.countries) || t.countries.length === 0) {
    return NextResponse.json(
      { error: "targeting.countries must be a non-empty string[]" },
      { status: 400 },
    );
  }
  if (typeof t.ageMin !== "number" || typeof t.ageMax !== "number") {
    return NextResponse.json(
      { error: "targeting.ageMin and ageMax must be numbers" },
      { status: 400 },
    );
  }
  let genders: number[] | null;
  if (t.genders === null) {
    genders = null;
  } else if (isNumberArray(t.genders)) {
    genders = t.genders;
  } else {
    return NextResponse.json(
      { error: "targeting.genders must be a number[] or null" },
      { status: 400 },
    );
  }

  // Placements null = automatic.
  let placements: {
    facebookPositions?: string[];
    instagramPositions?: string[];
  } | null = null;
  if (t.placements && typeof t.placements === "object") {
    const p = t.placements as Record<string, unknown>;
    placements = {
      facebookPositions: isStringArray(p.facebookPositions)
        ? p.facebookPositions
        : undefined,
      instagramPositions: isStringArray(p.instagramPositions)
        ? p.instagramPositions
        : undefined,
    };
  }

  // Promoted object — every field is optional; we just pick out the strings
  // that look right and pass them through. Meta validates the combination.
  let promotedObject:
    | {
        pixelId?: string;
        customEventType?: string;
        pageId?: string;
        applicationId?: string;
        objectStoreUrl?: string;
      }
    | undefined;
  if (body.promotedObject && typeof body.promotedObject === "object") {
    const po = body.promotedObject as Record<string, unknown>;
    promotedObject = {
      pixelId: typeof po.pixelId === "string" ? po.pixelId : undefined,
      customEventType:
        typeof po.customEventType === "string" ? po.customEventType : undefined,
      pageId: typeof po.pageId === "string" ? po.pageId : undefined,
      applicationId:
        typeof po.applicationId === "string" ? po.applicationId : undefined,
      objectStoreUrl:
        typeof po.objectStoreUrl === "string" ? po.objectStoreUrl : undefined,
    };
  }

  try {
    const result = await createAdSet({
      metaCampaignId: body.metaCampaignId,
      name: body.name,
      status: body.status,
      optimizationGoal: body.optimizationGoal,
      billingEvent:
        typeof body.billingEvent === "string" ? body.billingEvent : undefined,
      budgetType,
      budgetCents:
        typeof body.budgetCents === "number" ? body.budgetCents : undefined,
      startTime:
        typeof body.startTime === "string" ? body.startTime : undefined,
      endTime: typeof body.endTime === "string" ? body.endTime : undefined,
      targeting: {
        countries: t.countries,
        ageMin: t.ageMin,
        ageMax: t.ageMax,
        genders,
        placements,
      },
      promotedObject,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("create ad set error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
