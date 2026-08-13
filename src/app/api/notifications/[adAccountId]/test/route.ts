/**
 * POST /api/notifications/[adAccountId]/test
 *
 * Two modes, chosen by the body:
 *   {}                     → send a short "delivery is working" email
 *   { digest: true }       → send the REAL alert digest now, ignoring the
 *                            lastAlertDigestAt cursor
 *
 * The digest mode exists because "did the template look right?" and "does
 * mail reach us at all?" are different questions, and only the first one
 * needs real alert content. It deliberately does NOT advance the cursor —
 * a manual preview must not cause tomorrow's real digest to skip those
 * alerts.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isEmailConfigured, sendEmail } from "@/lib/email/client";
import { buildTestEmail } from "@/lib/email/templates";
import { sendAlertDigestForAccount } from "@/server/services/notifications/alert-digest";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ adAccountId: string }> },
) {
  const { adAccountId } = await params;

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "Email is not configured. Set RESEND_API_KEY and EMAIL_FROM" },
      { status: 400 },
    );
  }

  let digest = false;
  try {
    const body = (await req.json()) as { digest?: unknown };
    digest = body?.digest === true;
  } catch {
    // No body is fine — defaults to the simple test email.
  }

  const account = await prisma.metaAdAccount.findUnique({
    where: { id: adAccountId },
    select: { id: true, name: true, notification: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (!account.notification || account.notification.emails.length === 0) {
    return NextResponse.json(
      { error: "Add at least one recipient first" },
      { status: 400 },
    );
  }

  const dashboardUrl = process.env.APP_URL
    ? `${process.env.APP_URL}/dashboard/alerts`
    : undefined;

  if (digest) {
    const outcome = await sendAlertDigestForAccount(adAccountId, {
      force: true,
      dashboardUrl,
    });
    return NextResponse.json(
      outcome,
      outcome.status === "failed" ? { status: 502 } : undefined,
    );
  }

  const content = buildTestEmail(account.name);
  const result = await sendEmail({
    to: account.notification.emails,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    recipients: account.notification.emails.length,
  });
}
