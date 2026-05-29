/**
 * POST /api/duplicate
 *
 * Duplicate a campaign / ad set / ad. The copy is always created PAUSED.
 *
 * Body:
 *   {
 *     level: "campaign" | "adset" | "ad",
 *     metaId: string,
 *     deepCopy?: boolean,   // campaign/adset only — also copy children
 *   }
 */

import { NextResponse } from "next/server";
import { MetaApiError } from "@/lib/meta/client";
import {
  duplicateEntity,
  type DuplicateLevel,
} from "@/server/services/duplicate";

interface Body {
  level?: unknown;
  metaId?: unknown;
  deepCopy?: unknown;
}

const VALID_LEVELS: DuplicateLevel[] = ["campaign", "adset", "ad"];

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const level = VALID_LEVELS.includes(body.level as DuplicateLevel)
    ? (body.level as DuplicateLevel)
    : null;
  if (!level) {
    return NextResponse.json(
      { error: "level must be campaign, adset, or ad" },
      { status: 400 },
    );
  }
  if (typeof body.metaId !== "string" || !body.metaId.trim()) {
    return NextResponse.json({ error: "metaId is required" }, { status: 400 });
  }

  try {
    const result = await duplicateEntity({
      level,
      metaId: body.metaId,
      deepCopy: body.deepCopy === true,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("duplicate error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
