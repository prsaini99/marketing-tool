/**
 * PUT /api/accounts/[id]/schedules/[kind]
 *
 * `id` is the unprefixed Meta ad-account id (URL form).
 * `kind` is one of campaigns | adsets | ads | insights.
 *
 * Body: { frequency: FrequencyKey }
 *   "off" → schedule disabled (still stored, just `enabled=false`)
 *   any other preset → enabled with `nextRunAt` recomputed from now.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  computeNextRun,
  isFrequencyKey,
  SCHEDULE_KINDS,
  type ScheduleKind,
} from "@/lib/schedule";

interface Body {
  frequency?: unknown;
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; kind: string }> },
) {
  const { id: urlId, kind: rawKind } = await params;

  if (!SCHEDULE_KINDS.includes(rawKind as ScheduleKind)) {
    return NextResponse.json(
      { error: `Unknown kind: ${rawKind}` },
      { status: 400 },
    );
  }
  const kind = rawKind as ScheduleKind;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isFrequencyKey(body.frequency as string | undefined)) {
    return NextResponse.json(
      { error: "frequency must be one of the preset keys" },
      { status: 400 },
    );
  }
  const frequency = body.frequency as ReturnType<
    typeof isFrequencyKey
  > extends true
    ? never
    : Parameters<typeof computeNextRun>[0];

  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId: `act_${urlId}`, selectedForSync: true },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Ad account not found or not selected for sync" },
      { status: 404 },
    );
  }

  const enabled = frequency !== "off";
  const nextRunAt = enabled ? computeNextRun(frequency) : null;

  const row = await prisma.syncSchedule.upsert({
    where: {
      adAccountId_kind: { adAccountId: account.id, kind },
    },
    create: {
      adAccountId: account.id,
      kind,
      frequency,
      enabled,
      nextRunAt,
    },
    update: { frequency, enabled, nextRunAt },
  });

  return NextResponse.json({
    id: row.id,
    kind: row.kind,
    frequency: row.frequency,
    enabled: row.enabled,
    nextRunAt: row.nextRunAt,
  });
}
