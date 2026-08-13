/**
 * Alert digest delivery.
 *
 * Runs immediately after the daily anomaly scan: the scan writes Alert rows,
 * this mails whatever is new. Kept as a separate service — not folded into
 * detect-anomalies.ts — so a vendor outage can never cost us a completed
 * scan, and so the digest can be re-sent by hand without re-running the LLM.
 *
 * IDEMPOTENCY IS THE WHOLE PROBLEM HERE. The anomaly scan is safely
 * re-runnable: Alert rows are uniquely keyed on
 * [adAccountId, forDate, kind, entityId], so a second run upserts rather than
 * duplicates. Email has no such property — re-running would simply send the
 * digest twice. So delivery is bounded by `NotificationSetting
 * .lastAlertDigestAt`: only alerts CREATED after that stamp are mailed, and
 * the stamp advances only on a successful send. A failed send deliberately
 * leaves it untouched so the next run retries the same alerts rather than
 * skipping them — under-sending is a silent failure, and silence is what
 * this feature exists to prevent.
 *
 * `createdAt` is the cursor rather than `forDate` on purpose. Alerts are
 * dated by the day they describe (usually yesterday), so a late-arriving
 * alert for an already-mailed day would never be sent if the cursor were
 * forDate. Row creation time is what "new since last email" actually means.
 */

import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/client";
import { buildAlertDigestEmail, type AlertLine } from "@/lib/email/templates";

/** Ranked worst-first; index doubles as the severity floor comparison. */
const SEVERITY_ORDER = ["high", "medium", "low", "info"] as const;

function severityRank(s: string): number {
  const i = SEVERITY_ORDER.indexOf(
    s.toLowerCase() as (typeof SEVERITY_ORDER)[number],
  );
  // Unknown severities sort last but are never filtered out — a new alert
  // kind must not be silently dropped from delivery because its severity
  // string wasn't in this list yet.
  return i === -1 ? SEVERITY_ORDER.length : i;
}

/** True when `severity` is at least as serious as `floor`. */
export function meetsSeverityFloor(severity: string, floor: string): boolean {
  return severityRank(severity) <= severityRank(floor);
}

export interface DigestOutcome {
  adAccountId: string;
  accountName: string;
  status: "sent" | "skipped" | "failed";
  reason?: string;
  alertsSent?: number;
  recipients?: number;
}

export interface DigestRunResult {
  ranAt: string;
  accountsConsidered: number;
  sent: number;
  failed: number;
  outcomes: DigestOutcome[];
}

/**
 * Send one account's digest. Exported so the settings screen can trigger a
 * send on demand without waiting for tomorrow's cron.
 *
 * `force` ignores the lastAlertDigestAt cursor (used by "send now"), but
 * still respects the severity floor and the enabled flag — a manual trigger
 * should preview what the real digest looks like, not a different thing.
 */
export async function sendAlertDigestForAccount(
  adAccountId: string,
  opts: { force?: boolean; dashboardUrl?: string } = {},
): Promise<DigestOutcome> {
  const account = await prisma.metaAdAccount.findUnique({
    where: { id: adAccountId },
    select: { id: true, name: true, notification: true },
  });

  if (!account) {
    return {
      adAccountId,
      accountName: "(unknown)",
      status: "skipped",
      reason: "account not found",
    };
  }

  const base = { adAccountId, accountName: account.name };
  const setting = account.notification;

  if (!setting || !setting.alertsEnabled) {
    return { ...base, status: "skipped", reason: "alerts delivery disabled" };
  }
  if (setting.emails.length === 0) {
    return { ...base, status: "skipped", reason: "no recipients configured" };
  }

  const since = opts.force ? null : setting.lastAlertDigestAt;
  const alerts = await prisma.alert.findMany({
    where: {
      adAccountId,
      dismissedAt: null,
      ...(since ? { createdAt: { gt: since } } : {}),
    },
    orderBy: [{ forDate: "desc" }, { createdAt: "desc" }],
    select: {
      severity: true,
      title: true,
      body: true,
      entityName: true,
      forDate: true,
    },
    // A runaway scan must not produce a 200-item email. The dashboard is the
    // complete view; the digest is a prompt to go look at it.
    take: 25,
  });

  const worthSending = alerts.filter((a) =>
    meetsSeverityFloor(a.severity, setting.minSeverity),
  );

  if (worthSending.length === 0) {
    // Nothing to say. Advance the cursor anyway so alerts already considered
    // and rejected by the severity floor are not re-examined forever.
    if (!opts.force) {
      await prisma.notificationSetting.update({
        where: { adAccountId },
        data: { lastAlertDigestAt: new Date() },
      });
    }
    return { ...base, status: "skipped", reason: "no new alerts above floor" };
  }

  const lines: AlertLine[] = [...worthSending]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .map((a) => ({
      severity: a.severity,
      title: a.title,
      body: a.body,
      entityName: a.entityName,
    }));

  const forDate = worthSending[0].forDate.toISOString().slice(0, 10);
  const content = buildAlertDigestEmail({
    accountName: account.name,
    forDate,
    alerts: lines,
    dashboardUrl: opts.dashboardUrl,
  });

  const result = await sendEmail({
    to: setting.emails,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });

  if (!result.ok) {
    // Cursor deliberately NOT advanced — the next run retries these alerts.
    return {
      ...base,
      status: result.disabled ? "skipped" : "failed",
      reason: result.error,
    };
  }

  await prisma.notificationSetting.update({
    where: { adAccountId },
    data: { lastAlertDigestAt: new Date() },
  });

  return {
    ...base,
    status: "sent",
    alertsSent: lines.length,
    recipients: setting.emails.length,
  };
}

/**
 * Walk every account that has delivery configured and send its digest.
 *
 * Sequential, like every other multi-account loop in this codebase: a fan-out
 * would hammer the email vendor's rate limit the same way it would Meta's,
 * and there is no deadline pressure on a daily cron.
 *
 * Never throws — the caller is a cron route that has already completed the
 * expensive scan.
 */
export async function sendAllAlertDigests(
  opts: { dashboardUrl?: string } = {},
): Promise<DigestRunResult> {
  const settings = await prisma.notificationSetting.findMany({
    where: { alertsEnabled: true },
    select: { adAccountId: true },
  });

  const outcomes: DigestOutcome[] = [];
  for (const s of settings) {
    try {
      outcomes.push(
        await sendAlertDigestForAccount(s.adAccountId, {
          dashboardUrl: opts.dashboardUrl,
        }),
      );
    } catch (e) {
      outcomes.push({
        adAccountId: s.adAccountId,
        accountName: "(unknown)",
        status: "failed",
        reason: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  return {
    ranAt: new Date().toISOString(),
    accountsConsidered: settings.length,
    sent: outcomes.filter((o) => o.status === "sent").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    outcomes,
  };
}
