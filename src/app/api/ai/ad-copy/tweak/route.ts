/**
 * POST /api/ai/ad-copy/tweak
 *
 * Apply a small change to one already-generated copy variant without
 * regenerating the whole batch. The strategist picked a variant they like,
 * we tweak it surgically.
 *
 * Body: { accountId, brief, original: { headline, primaryText, description },
 *         instruction }
 * Returns: { variant: { headline, primaryText, description } }
 */

import { NextResponse } from "next/server";
import { tweakAdCopy } from "@/server/services/ai/generate-ad-copy";

export async function POST(req: Request) {
  let body: {
    accountId?: unknown;
    brief?: unknown;
    original?: unknown;
    instruction?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.accountId !== "string" || !body.accountId.trim()) {
    return NextResponse.json(
      { error: "accountId is required" },
      { status: 400 },
    );
  }
  if (typeof body.instruction !== "string" || !body.instruction.trim()) {
    return NextResponse.json(
      { error: "instruction is required" },
      { status: 400 },
    );
  }
  const original = body.original as {
    headline?: unknown;
    primaryText?: unknown;
    description?: unknown;
  } | null;
  if (
    !original ||
    typeof original.headline !== "string" ||
    typeof original.primaryText !== "string" ||
    typeof original.description !== "string"
  ) {
    return NextResponse.json(
      {
        error:
          "original must be { headline, primaryText, description } — all strings",
      },
      { status: 400 },
    );
  }

  try {
    const result = await tweakAdCopy({
      metaAdAccountId: body.accountId.trim(),
      brief: typeof body.brief === "string" ? body.brief : "",
      original: {
        headline: original.headline,
        primaryText: original.primaryText,
        description: original.description,
      },
      instruction: body.instruction.trim(),
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("ad-copy tweak error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
