/**
 * PATCH  /api/rules/[id] — enable/disable or rename
 * DELETE /api/rules/[id] — remove
 *
 * Threshold and condition are deliberately NOT editable here. A rule's
 * `lastFiredAt` and cooldown describe the behaviour of the rule as it was
 * when it fired; silently repointing an existing rule at a different metric
 * would leave that history attached to a rule that never produced it. Change
 * of condition = new rule, which also forces a fresh dry run.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { enabled?: unknown; name?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: { enabled?: boolean; name?: string } = {};
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const rule = await prisma.adRule.update({ where: { id }, data });
    return NextResponse.json({ rule });
  } catch {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await prisma.adRule.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
}
