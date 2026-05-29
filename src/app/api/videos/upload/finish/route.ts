/**
 * POST /api/videos/upload/finish — close the session + mirror locally.
 * Body: { metaAdAccountId, uploadSessionId, videoId, title?, description? }
 * Returns: { videoId }
 */

import { NextResponse } from "next/server";
import { MetaApiError } from "@/lib/meta/client";
import { finishVideoUpload } from "@/server/services/videos/upload";

export async function POST(req: Request) {
  let body: {
    metaAdAccountId?: unknown;
    uploadSessionId?: unknown;
    videoId?: unknown;
    title?: unknown;
    description?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  if (!str(body.metaAdAccountId)?.trim()) {
    return NextResponse.json(
      { error: "metaAdAccountId is required" },
      { status: 400 },
    );
  }
  if (!str(body.uploadSessionId)?.trim()) {
    return NextResponse.json(
      { error: "uploadSessionId is required" },
      { status: 400 },
    );
  }
  if (!str(body.videoId)?.trim()) {
    return NextResponse.json({ error: "videoId is required" }, { status: 400 });
  }

  try {
    const result = await finishVideoUpload({
      metaAdAccountId: str(body.metaAdAccountId) as string,
      uploadSessionId: str(body.uploadSessionId) as string,
      videoId: str(body.videoId) as string,
      title: str(body.title),
      description: str(body.description),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("video upload finish error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
