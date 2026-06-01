/**
 * DELETE /api/conversions/[id] — permanently delete a custom conversion on
 * Meta and remove the local mirror. Irreversible. `[id]` is the Meta
 * custom conversion id.
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
    return NextResponse.json(
      { error: "Missing conversion id" },
      { status: 400 },
    );
  }
  try {
    const result = await deleteEntity({ level: "conversion", metaId: id });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("delete conversion error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
