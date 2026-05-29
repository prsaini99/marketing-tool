/**
 * PATCH /api/campaigns/[id]
 *
 * Edit a single campaign. `[id]` is the Meta campaign id. Body carries only
 * the fields the user changed; the service diffs against current values and
 * forwards just the delta to Meta.
 *
 * Body (all optional):
 *   {
 *     name?: string,
 *     status?: "ACTIVE" | "PAUSED",
 *     budgetType?: "daily" | "lifetime",
 *     budgetCents?: number,
 *     spendCapCents?: number,
 *   }
 */

import { NextResponse } from "next/server";
import { MetaApiError } from "@/lib/meta/client";
import { updateCampaign } from "@/server/services/campaigns/update";
import { deleteEntity } from "@/server/services/delete";

interface Body {
  name?: unknown;
  status?: unknown;
  budgetType?: unknown;
  budgetCents?: unknown;
  spendCapCents?: unknown;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing campaign id" }, { status: 400 });
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
    const result = await updateCampaign({
      metaCampaignId: id,
      name: typeof body.name === "string" ? body.name : undefined,
      status,
      budgetType,
      budgetCents:
        typeof body.budgetCents === "number" ? body.budgetCents : undefined,
      spendCapCents:
        typeof body.spendCapCents === "number"
          ? body.spendCapCents
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
    console.error("update campaign error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/campaigns/[id] — permanently delete the campaign on Meta
 * (cascades to its ad sets + ads) and remove the local mirror. Irreversible.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing campaign id" }, { status: 400 });
  }
  try {
    const result = await deleteEntity({ level: "campaign", metaId: id });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        { error: err.message, metaCode: err.metaCode },
        { status: err.httpStatus >= 500 ? 502 : 400 },
      );
    }
    console.error("delete campaign error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
