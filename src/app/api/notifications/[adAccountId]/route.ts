/**
 * GET  /api/notifications/[adAccountId] — read delivery settings
 * PUT  /api/notifications/[adAccountId] — create or replace them
 *
 * `adAccountId` is the LOCAL MetaAdAccount.id (a cuid), not the Meta
 * "act_..." id — this endpoint never talks to Meta, so there is nothing to
 * prefix and no reason to make the caller translate.
 *
 * GET returns a synthetic default for an account that has never been
 * configured rather than 404ing, so the settings form renders the same way
 * for a fresh account as for a configured one. `configured: false` is how
 * the UI can still tell the difference.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isValidEmail } from "@/lib/email/client";

const SEVERITIES = ["high", "medium", "low"] as const;
const MAX_RECIPIENTS = 10;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ adAccountId: string }> },
) {
  const { adAccountId } = await params;

  const account = await prisma.metaAdAccount.findUnique({
    where: { id: adAccountId },
    select: { id: true, name: true, notification: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const s = account.notification;
  return NextResponse.json({
    accountName: account.name,
    configured: Boolean(s),
    emails: s?.emails ?? [],
    alertsEnabled: s?.alertsEnabled ?? true,
    weeklyEnabled: s?.weeklyEnabled ?? false,
    minSeverity: s?.minSeverity ?? "medium",
    lastAlertDigestAt: s?.lastAlertDigestAt ?? null,
    lastWeeklySentAt: s?.lastWeeklySentAt ?? null,
  });
}

interface Body {
  emails?: unknown;
  alertsEnabled?: unknown;
  weeklyEnabled?: unknown;
  minSeverity?: unknown;
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ adAccountId: string }> },
) {
  const { adAccountId } = await params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const account = await prisma.metaAdAccount.findUnique({
    where: { id: adAccountId },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // Recipients: de-duplicated, lowercased, validated. An invalid address is
  // rejected loudly rather than silently dropped — a typo'd address that
  // quietly disappears looks identical to "delivery is broken" from the
  // operator's side, and they'd have no way to tell which.
  if (!Array.isArray(body.emails)) {
    return NextResponse.json(
      { error: "emails must be an array" },
      { status: 400 },
    );
  }
  const emails = Array.from(
    new Set(
      body.emails
        .filter((e): e is string => typeof e === "string")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const invalid = emails.filter((e) => !isValidEmail(e));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid email address: ${invalid.join(", ")}` },
      { status: 400 },
    );
  }
  if (emails.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `At most ${MAX_RECIPIENTS} recipients` },
      { status: 400 },
    );
  }

  const minSeverity =
    typeof body.minSeverity === "string" &&
    (SEVERITIES as readonly string[]).includes(body.minSeverity)
      ? body.minSeverity
      : "medium";

  const data = {
    emails,
    alertsEnabled: body.alertsEnabled !== false,
    weeklyEnabled: body.weeklyEnabled === true,
    minSeverity,
  };

  const saved = await prisma.notificationSetting.upsert({
    where: { adAccountId },
    create: { adAccountId, ...data },
    update: data,
  });

  return NextResponse.json({
    configured: true,
    emails: saved.emails,
    alertsEnabled: saved.alertsEnabled,
    weeklyEnabled: saved.weeklyEnabled,
    minSeverity: saved.minSeverity,
    lastAlertDigestAt: saved.lastAlertDigestAt,
    lastWeeklySentAt: saved.lastWeeklySentAt,
  });
}
