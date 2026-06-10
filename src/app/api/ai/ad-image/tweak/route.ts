/**
 * POST /api/ai/ad-image/tweak
 *
 * Image-to-image edit: takes the variant the strategist liked and applies
 * a surgical modification ("make her smile" / "warmer lighting") via
 * OpenAI's images.edit endpoint. The composition / subject / framing of
 * the original are preserved — only what the instruction asks changes.
 *
 * Body: { brief?, instruction, originalB64 }
 * Returns: { variant: { b64, mimeType }, prompt }
 */

import { NextResponse } from "next/server";
import { tweakAdImage } from "@/server/services/ai/generate-ad-image";

export const maxDuration = 60;

function parseQuality(v: unknown): "low" | "medium" | "high" | undefined {
  return v === "low" || v === "medium" || v === "high" ? v : undefined;
}

export async function POST(req: Request) {
  let body: {
    brief?: unknown;
    instruction?: unknown;
    originalB64?: unknown;
    quality?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.instruction !== "string" || !body.instruction.trim()) {
    return NextResponse.json(
      { error: "instruction is required" },
      { status: 400 },
    );
  }
  if (typeof body.originalB64 !== "string" || !body.originalB64.trim()) {
    return NextResponse.json(
      {
        error:
          "originalB64 is required — the image being tweaked must be sent so the edit preserves it",
      },
      { status: 400 },
    );
  }

  try {
    const result = await tweakAdImage({
      brief: typeof body.brief === "string" ? body.brief : "",
      instruction: body.instruction.trim(),
      originalB64: body.originalB64,
      quality: parseQuality(body.quality),
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("ad-image tweak error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
