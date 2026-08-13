/**
 * Email HTML. Pure string builders — no DB, no vendor, no React.
 *
 * Hand-written HTML rather than a component library because email clients
 * are not browsers: Outlook renders through Word's engine, Gmail strips
 * <style> blocks in some contexts, and flexbox/grid are unreliable
 * everywhere. So: tables for structure, inline styles only, no external
 * assets, no web fonts. It looks dated as source; it renders correctly.
 *
 * Every builder returns { subject, html, text }. The plain-text arm is not
 * decoration — corporate mail gateways strip HTML often enough that a
 * text-only reader must still get the numbers.
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface AlertLine {
  severity: string;
  title: string;
  body: string;
  entityName?: string | null;
}

const BRAND = "#4f46e5";
const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Severity → dot colour. Unknown severities fall back to muted grey. */
function severityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case "high":
      return "#dc2626";
    case "medium":
      return "#d97706";
    case "low":
      return "#2563eb";
    default:
      return MUTED;
  }
}

function shell(title: string, inner: string, footerNote: string): string {
  return `<!-- ${escapeHtml(title)} -->
<div style="background:#f9fafb;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:8px;">
        <tr>
          <td style="padding:20px 24px;border-bottom:1px solid ${LINE};">
            <div style="font-size:16px;font-weight:600;color:${INK};">${escapeHtml(title)}</div>
          </td>
        </tr>
        <tr><td style="padding:20px 24px;">${inner}</td></tr>
        <tr>
          <td style="padding:16px 24px;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;line-height:18px;">
            ${escapeHtml(footerNote)}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</div>`;
}

/**
 * Daily alert digest for one ad account.
 *
 * Alerts arrive pre-sorted by the caller (severity first) — this builder
 * does no ranking of its own, so the email order always matches what the
 * dashboard shows.
 */
export function buildAlertDigestEmail(params: {
  accountName: string;
  forDate: string;
  alerts: AlertLine[];
  dashboardUrl?: string;
}): EmailContent {
  const { accountName, forDate, alerts, dashboardUrl } = params;
  const count = alerts.length;
  const subject =
    count === 1
      ? `${accountName}: 1 alert (${forDate})`
      : `${accountName}: ${count} alerts (${forDate})`;

  const rows = alerts
    .map(
      (a) => `
      <tr><td style="padding:12px 0;border-bottom:1px solid ${LINE};">
        <div style="font-size:14px;font-weight:600;color:${INK};">
          <span style="display:inline-block;width:8px;height:8px;border-radius:8px;background:${severityColor(a.severity)};margin-right:8px;"></span>
          ${escapeHtml(a.title)}
        </div>
        ${a.entityName ? `<div style="font-size:12px;color:${MUTED};margin:2px 0 0 16px;">${escapeHtml(a.entityName)}</div>` : ""}
        <div style="font-size:13px;color:#374151;line-height:20px;margin:6px 0 0 16px;">${escapeHtml(a.body)}</div>
      </td></tr>`,
    )
    .join("");

  const cta = dashboardUrl
    ? `<div style="margin-top:20px;">
         <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:6px;">Open alerts</a>
       </div>`
    : "";

  const inner = `
    <div style="font-size:13px;color:${MUTED};margin-bottom:4px;">Account</div>
    <div style="font-size:15px;font-weight:600;color:${INK};margin-bottom:16px;">${escapeHtml(accountName)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>
    ${cta}`;

  const text = [
    `${accountName}: ${count} alert${count === 1 ? "" : "s"} for ${forDate}`,
    "",
    ...alerts.map(
      (a) =>
        `[${a.severity.toUpperCase()}] ${a.title}${a.entityName ? ` (${a.entityName})` : ""}\n${a.body}`,
    ),
    dashboardUrl ? `\nOpen alerts: ${dashboardUrl}` : "",
  ].join("\n");

  return {
    subject,
    html: shell(
      "Daily alerts",
      inner,
      "You're receiving this because alert delivery is enabled for this ad account.",
    ),
    text,
  };
}

/**
 * Weekly narrative report. `bodyMarkdown` is the LLM's prose; only a minimal
 * subset of Markdown is converted (headings, bold, bullets, paragraphs)
 * because a full parser in an email template is the wrong dependency and the
 * generator's output is a known, narrow shape.
 */
export function buildWeeklyReportEmail(params: {
  accountName: string;
  periodLabel: string;
  bodyMarkdown: string;
  dashboardUrl?: string;
}): EmailContent {
  const { accountName, periodLabel, bodyMarkdown, dashboardUrl } = params;

  const html = bodyMarkdown
    .split(/\n{2,}/)
    .map((block) => {
      const b = block.trim();
      if (!b) return "";
      if (/^#{1,6}\s/.test(b)) {
        const text = b.replace(/^#{1,6}\s/, "");
        return `<div style="font-size:15px;font-weight:600;color:${INK};margin:18px 0 6px;">${inline(text)}</div>`;
      }
      if (/^[-*]\s/m.test(b)) {
        const items = b
          .split("\n")
          .filter((l) => /^[-*]\s/.test(l.trim()))
          .map(
            (l) =>
              `<li style="margin:4px 0;">${inline(l.trim().replace(/^[-*]\s/, ""))}</li>`,
          )
          .join("");
        return `<ul style="margin:8px 0;padding-left:20px;font-size:14px;color:#374151;line-height:22px;">${items}</ul>`;
      }
      return `<p style="margin:10px 0;font-size:14px;color:#374151;line-height:22px;">${inline(b)}</p>`;
    })
    .join("");

  const cta = dashboardUrl
    ? `<div style="margin-top:20px;">
         <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:6px;">Open report</a>
       </div>`
    : "";

  const inner = `
    <div style="font-size:13px;color:${MUTED};margin-bottom:4px;">${escapeHtml(periodLabel)}</div>
    <div style="font-size:15px;font-weight:600;color:${INK};margin-bottom:12px;">${escapeHtml(accountName)}</div>
    ${html}
    ${cta}`;

  return {
    subject: `${accountName}: weekly performance (${periodLabel})`,
    html: shell(
      "Weekly report",
      inner,
      "You're receiving this because weekly reports are enabled for this ad account.",
    ),
    text: `${accountName}: weekly performance (${periodLabel})\n\n${bodyMarkdown}${dashboardUrl ? `\n\nOpen report: ${dashboardUrl}` : ""}`,
  };
}

/** Escape first, then re-introduce only **bold** — never the reverse. */
function inline(s: string): string {
  return escapeHtml(s).replace(
    /\*\*([^*]+)\*\*/g,
    `<strong style="color:${INK};">$1</strong>`,
  );
}

/** Small confirmation email for the "send test" button. */
export function buildTestEmail(accountName: string): EmailContent {
  return {
    subject: `Test email for ${accountName}`,
    html: shell(
      "Test email",
      `<p style="margin:0;font-size:14px;color:#374151;line-height:22px;">
         Delivery is working. Alerts and weekly reports for
         <strong style="color:${INK};">${escapeHtml(accountName)}</strong> will arrive at this address.
       </p>`,
      "Sent from the notification settings screen.",
    ),
    text: `Delivery is working. Alerts and weekly reports for ${accountName} will arrive at this address.`,
  };
}
