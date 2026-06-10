/**
 * POST /api/ai/ad-copy/generate
 *
 * Brand-voice ad-copy generation for the Create-Ad modal.
 *
 * Body: { accountId, brief, count? }
 * Returns: { variants: [{ headline, primaryText, description }], groundedIn: […] }
 */

import { NextResponse } from "next/server";
import { generateAdCopy } from "@/server/services/ai/generate-ad-copy";

export async function POST(req: Request) {
  let body: {
    accountId?: unknown;
    brief?: unknown;
    count?: unknown;
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
  if (typeof body.brief !== "string" || !body.brief.trim()) {
    return NextResponse.json(
      { error: "brief is required" },
      { status: 400 },
    );
  }
  const count =
    typeof body.count === "number" && Number.isFinite(body.count)
      ? body.count
      : undefined;

  try {
    const result = await generateAdCopy({
      metaAdAccountId: body.accountId.trim(),
      brief: body.brief.trim(),
      count,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("ad-copy generate error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
