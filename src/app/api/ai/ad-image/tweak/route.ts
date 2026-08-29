/**
 * POST /api/ai/ad-image/tweak
 *
 * Image-to-image edit: takes the variant the strategist liked and applies
 * a surgical modification ("make her smile" / "warmer lighting") via
 * OpenAI's images.edit endpoint. The composition / subject / framing of
 * the original are preserved — only what the instruction asks changes.
 *
 * Body: { brief?, instruction, originalB64, quality?, model?, size? }
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
    model?: unknown;
    size?: unknown;
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
          "originalB64 is required. Send the image being tweaked so the edit can preserve it",
      },
      { status: 400 },
    );
  }

  // Validated the same way the generate route validates `model` — a
  // non-empty trimmed string, or omitted so tweakAdImage falls back to
  // DEFAULT_MODEL (which is also what the pre-existing AiStudioPanel
  // caller gets, since it never sends this field).
  const model =
    typeof body.model === "string" && body.model.trim() ? body.model : undefined;

  try {
    const result = await tweakAdImage({
      brief: typeof body.brief === "string" ? body.brief : "",
      instruction: body.instruction.trim(),
      originalB64: body.originalB64,
      quality: parseQuality(body.quality),
      model,
      // Must match the size the original was generated at, or a tweak
      // returns a differently-shaped image than the one being tweaked.
      size:
        typeof body.size === "string" && body.size.trim()
          ? body.size.trim()
          : undefined,
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
