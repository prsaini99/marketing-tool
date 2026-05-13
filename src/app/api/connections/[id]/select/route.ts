/**
 * PATCH /api/connections/[id]/select
 *
 * Body: { metaAdAccountIds: string[] }  (prefixed form: "act_1234567890")
 *
 * Sets `selectedForSync = true` on the listed ad accounts under this
 * connection; sets all others under the same connection to `false`.
 * Phase 1 sync jobs will read this flag to decide what to mirror.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

interface SelectRequestBody {
  metaAdAccountIds?: unknown;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: connectionId } = await params;

  let body: SelectRequestBody;
  try {
    body = (await req.json()) as SelectRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = Array.isArray(body.metaAdAccountIds)
    ? body.metaAdAccountIds.filter((x): x is string => typeof x === "string")
    : null;

  if (ids === null) {
    return NextResponse.json(
      { error: "metaAdAccountIds must be an array of strings" },
      { status: 400 },
    );
  }

  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
  });
  if (!connection) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 },
    );
  }

  if (ids.length === 0) {
    // Nothing selected — clear all flags under this connection.
    await prisma.metaAdAccount.updateMany({
      where: { business: { connectionId } },
      data: { selectedForSync: false },
    });
  } else {
    await prisma.$transaction([
      prisma.metaAdAccount.updateMany({
        where: {
          business: { connectionId },
          metaAdAccountId: { in: ids },
        },
        data: { selectedForSync: true },
      }),
      prisma.metaAdAccount.updateMany({
        where: {
          business: { connectionId },
          metaAdAccountId: { notIn: ids },
        },
        data: { selectedForSync: false },
      }),
    ]);
  }

  return NextResponse.json({
    connectionId,
    selectedCount: ids.length,
  });
}
