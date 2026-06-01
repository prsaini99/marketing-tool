/**
 * PATCH /api/adsets/[id]
 *
 * Edit a single ad set. `[id]` is the Meta ad set id. Body carries only the
 * fields the user changed; the service diffs against current values and
 * forwards just the delta to Meta.
 *
 * Body (all optional):
 *   {
 *     name?: string,
 *     status?: "ACTIVE" | "PAUSED",
 *     budgetType?: "daily" | "lifetime",
 *     budgetCents?: number,
 *   }
 */

import { NextResponse } from "next/server";
import { MetaApiError } from "@/lib/meta/client";
import { updateAdSet } from "@/server/services/adsets/update";
import { deleteEntity } from "@/server/services/delete";

interface Body {
  name?: unknown;
  status?: unknown;
  budgetType?: unknown;
  budgetCents?: unknown;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing ad set id" }, { status: 400 });
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
  const budgetType =
    body.budgetType === "daily" || body.budgetType === "lifetime"
      ? body.budgetType
      : undefined;

  try {
    const result = await updateAdSet({
      metaAdSetId: id,
      name: typeof body.name === "string" ? body.name : undefined,
      status,
      budgetType,
      budgetCents:
        typeof body.budgetCents === "number" ? body.budgetCents : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("update ad set error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/adsets/[id] — permanently delete the ad set on Meta (cascades
 * to its ads) and remove the local mirror. Irreversible.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing ad set id" }, { status: 400 });
  }
  try {
    const result = await deleteEntity({ level: "adset", metaId: id });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("delete ad set error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
