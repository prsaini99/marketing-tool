/**
 * POST /api/conversions
 *
 * Create a custom conversion. See src/server/services/conversions/create.ts.
 *
 * Body:
 *   {
 *     metaAdAccountId: string,
 *     name: string,
 *     description?: string,
 *     pixelId: string,            // event_source_id
 *     customEventType: string,    // PURCHASE | LEAD | OTHER | …
 *     ruleType: "url_contains" | "url_equals" | "event_equals",
 *     ruleValue: string,
 *   }
 */

import { NextResponse } from "next/server";
import { MetaApiError } from "@/lib/meta/client";
import {
  createCustomConversion,
  type ConversionRuleType,
} from "@/server/services/conversions/create";

interface Body {
  metaAdAccountId?: unknown;
  name?: unknown;
  description?: unknown;
  pixelId?: unknown;
  customEventType?: unknown;
  ruleType?: unknown;
  ruleValue?: unknown;
}

const VALID_RULE_TYPES: ConversionRuleType[] = [
  "url_contains",
  "url_equals",
  "event_equals",
];

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
  if (typeof body.pixelId !== "string" || !body.pixelId.trim()) {
    return NextResponse.json({ error: "pixelId is required" }, { status: 400 });
  }
  if (
    typeof body.customEventType !== "string" ||
    !body.customEventType.trim()
  ) {
    return NextResponse.json(
      { error: "customEventType is required" },
      { status: 400 },
    );
  }
  const ruleType = VALID_RULE_TYPES.includes(body.ruleType as ConversionRuleType)
    ? (body.ruleType as ConversionRuleType)
    : null;
  if (!ruleType) {
    return NextResponse.json(
      { error: "ruleType must be url_contains, url_equals, or event_equals" },
      { status: 400 },
    );
  }
  if (typeof body.ruleValue !== "string" || !body.ruleValue.trim()) {
    return NextResponse.json(
      { error: "ruleValue is required" },
      { status: 400 },
    );
  }

  try {
    const result = await createCustomConversion({
      metaAdAccountId: body.metaAdAccountId,
      name: body.name,
      description:
        typeof body.description === "string" ? body.description : undefined,
      pixelId: body.pixelId,
      customEventType: body.customEventType,
      ruleType,
      ruleValue: body.ruleValue,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("create conversion error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
