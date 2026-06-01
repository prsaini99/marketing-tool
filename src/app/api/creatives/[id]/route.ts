/**
 * DELETE /api/creatives/[id] — delete an ad creative on Meta + remove the
 * local mirror. Meta rejects if the creative is still used by an ad; that
 * error is surfaced verbatim. `[id]` is the Meta creative id.
 */

import { NextResponse } from "next/server";
import { MetaApiError } from "@/lib/meta/client";
import { deleteEntity } from "@/server/services/delete";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing creative id" }, { status: 400 });
  }
  try {
    const result = await deleteEntity({ level: "creative", metaId: id });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("delete creative error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
