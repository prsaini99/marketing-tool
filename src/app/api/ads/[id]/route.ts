/**
 * PATCH /api/ads/[id]
 *
 * Edit a single ad. `[id]` is the Meta ad id. Body carries only the fields
 * the user changed; the service diffs against current values and forwards
 * just the delta to Meta.
 *
 * Body (all optional):
 *   {
 *     name?: string,
 *     status?: "ACTIVE" | "PAUSED",
 *     metaCreativeId?: string,   // swap to a different existing creative
 *   }
 */

import { NextResponse } from "next/server";
import { MetaApiError } from "@/lib/meta/client";
import { updateAd } from "@/server/services/ads/update";
import { deleteEntity } from "@/server/services/delete";

interface Body {
  name?: unknown;
  status?: unknown;
  metaCreativeId?: unknown;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing ad id" }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status =
    body.status === "ACTIVE" || body.status === "PAUSED"
      ? body.status
      : undefined;

  try {
    const result = await updateAd({
      metaAdId: id,
      name: typeof body.name === "string" ? body.name : undefined,
      status,
      metaCreativeId:
        typeof body.metaCreativeId === "string"
          ? body.metaCreativeId
          : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("update ad error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/ads/[id] — permanently delete the ad on Meta and remove the
 * local mirror. Irreversible.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing ad id" }, { status: 400 });
  }
  try {
    const result = await deleteEntity({ level: "ad", metaId: id });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("delete ad error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
