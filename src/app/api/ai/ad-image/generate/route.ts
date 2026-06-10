/**
 * POST /api/ai/ad-image/generate
 *
 * Generate N image variants from a brief using OpenAI's gpt-image-1. Returns
 * base64-encoded PNGs so the client can render immediately; if the user picks
 * one, the bytes get POSTed to /api/images to land in Meta's library.
 *
 * Body: { brief, count? }
 * Returns: { variants: [{ b64, mimeType }], prompt }
 */

import { NextResponse } from "next/server";
import { generateAdImages } from "@/server/services/ai/generate-ad-image";

// gpt-image-1 calls can take 15–40s for 3–4 variants at medium quality.
// Bump the default 10s ceiling so they don't get cut short.
export const maxDuration = 120;

function parseQuality(v: unknown): "low" | "medium" | "high" | undefined {
  return v === "low" || v === "medium" || v === "high" ? v : undefined;
}

export async function POST(req: Request) {
  let body: { brief?: unknown; count?: unknown; quality?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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
    const result = await generateAdImages({
      brief: body.brief.trim(),
      count,
      quality: parseQuality(body.quality),
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("ad-image generate error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
