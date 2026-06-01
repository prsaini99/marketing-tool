/**
 * DELETE /api/images/[id] — delete an ad image on Meta + remove the local
 * mirror. `[id]` is the image content HASH (images have no numeric id).
 * Meta rejects if the image is still used by a creative; surfaced verbatim.
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
    return NextResponse.json({ error: "Missing image hash" }, { status: 400 });
  }
  try {
    // `metaId` carries the image hash for the image level.
    const result = await deleteEntity({ level: "image", metaId: id });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("delete image error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
