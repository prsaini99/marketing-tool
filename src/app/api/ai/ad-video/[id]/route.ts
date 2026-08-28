/**
 * GET /api/ai/ad-video/[id]?client=<businessId>
 *
 * Polls one generation forward: asks the vendor, and on completion copies the
 * clip into our own bucket. The scope is part of the lookup rather than a
 * check afterwards, matching the sibling list route — an absent or empty
 * `client` is the workspace's own scope, exactly as /api/brand-kit folds it.
 * Today's single-operator gate makes this invisible; the day client sessions
 * land it is the difference between a scoped read and a cross-client one.
 */

import { NextResponse } from "next/server";
import { advanceVideoGeneration, toPublic } from "@/server/services/video/generation";

export const maxDuration = 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const client = new URL(req.url).searchParams.get("client")?.trim();
  const row = await advanceVideoGeneration(id, client ? client : null);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(toPublic(row));
}
