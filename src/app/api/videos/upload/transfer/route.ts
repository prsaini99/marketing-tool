/**
 * POST /api/videos/upload/transfer — forward one chunk to Meta.
 *
 * multipart/form-data:
 *   metaAdAccountId, uploadSessionId, startOffset, chunk (Blob)
 *
 * Returns the next { startOffset, endOffset }. Each chunk is kept under
 * ~4 MB by the client so this request clears Vercel's body cap.
 */

import { NextResponse } from "next/server";
import { MetaApiError } from "@/lib/meta/client";
import { transferVideoChunk } from "@/server/services/videos/upload";

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const metaAdAccountId = form.get("metaAdAccountId");
  const uploadSessionId = form.get("uploadSessionId");
  const startOffsetRaw = form.get("startOffset");
  const chunk = form.get("chunk");

  if (typeof metaAdAccountId !== "string" || !metaAdAccountId) {
    return NextResponse.json(
      { error: "metaAdAccountId is required" },
      { status: 400 },
    );
  }
  if (typeof uploadSessionId !== "string" || !uploadSessionId) {
    return NextResponse.json(
      { error: "uploadSessionId is required" },
      { status: 400 },
    );
  }
  const startOffset =
    typeof startOffsetRaw === "string" ? Number.parseInt(startOffsetRaw, 10) : NaN;
  if (!Number.isFinite(startOffset)) {
    return NextResponse.json(
      { error: "startOffset must be a number" },
      { status: 400 },
    );
  }
  if (!(chunk instanceof Blob)) {
    return NextResponse.json({ error: "chunk is required" }, { status: 400 });
  }

  try {
    const result = await transferVideoChunk(
      metaAdAccountId,
      uploadSessionId,
      startOffset,
      chunk,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("video upload transfer error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
