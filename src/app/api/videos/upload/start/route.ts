/**
 * POST /api/videos/upload/start — open a resumable upload session.
 * Body: { metaAdAccountId, fileSize }
 * Returns: { uploadSessionId, videoId, startOffset, endOffset }
 */

import { NextResponse } from "next/server";
import { MetaApiError } from "@/lib/meta/client";
import { startVideoUpload } from "@/server/services/videos/upload";

export async function POST(req: Request) {
  let body: { metaAdAccountId?: unknown; fileSize?: unknown };
  try {
    body = (await req.json()) as typeof body;
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
  if (typeof body.fileSize !== "number" || body.fileSize <= 0) {
    return NextResponse.json(
      { error: "fileSize must be a positive number" },
      { status: 400 },
    );
  }

  try {
    const result = await startVideoUpload(body.metaAdAccountId, body.fileSize);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("video upload start error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
