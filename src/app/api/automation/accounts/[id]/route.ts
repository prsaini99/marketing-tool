/**
 * PATCH /api/automation/accounts/[id] — toggle the bot for one IG account.
 * Body: { botEnabled: boolean }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { botEnabled?: unknown };
  try {
    body = (await req.json()) as { botEnabled?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.botEnabled !== "boolean") {
    return NextResponse.json(
      { error: "botEnabled must be a boolean" },
      { status: 400 },
    );
  }
  try {
    await prisma.instagramAccount.update({
      where: { id },
      data: { botEnabled: body.botEnabled },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Instagram account not found" },
      { status: 404 },
    );
  }
}
