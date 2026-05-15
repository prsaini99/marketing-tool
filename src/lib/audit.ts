/**
 * Audit-log presentation helpers — single source of truth for how a raw
 * `AuditLog` row gets turned into something a human can scan in the UI.
 *
 * Action codes the bulk-op services write today (kept in lockstep with
 * server/services/{campaigns,adsets,ads}/bulk-*.ts):
 *
 *   campaign.pause | campaign.activate | campaign.archive | campaign.budget_update
 *   adset.pause    | adset.activate    | adset.archive    | adset.budget_update
 *   ad.pause       | ad.activate       | ad.archive
 */

export type AuditTargetType = "campaign" | "adset" | "ad";

export const TARGET_TYPE_LABEL: Record<string, string> = {
  campaign: "Campaign",
  adset: "Ad set",
  ad: "Ad",
};

const ACTION_VERB_LABEL: Record<string, string> = {
  pause: "Paused",
  activate: "Activated",
  archive: "Archived",
  budget_update: "Budget updated",
};

export function getActionLabel(action: string): string {
  const [, verb = ""] = action.split(".");
  return ACTION_VERB_LABEL[verb] ?? action;
}

export function getActionKind(action: string): "status" | "budget" | "other" {
  if (action.endsWith(".budget_update")) return "budget";
  if (
    action.endsWith(".pause") ||
    action.endsWith(".activate") ||
    action.endsWith(".archive")
  ) {
    return "status";
  }
  return "other";
}

// Pull a {ok|failed|pending} verdict out of the `after` JSON the services write.
// Success rows omit the `_failed` flag; failed rows set `_failed: true`; the
// brief moment between create and Meta-call-completion sets `_pending: true`.
export function getAuditStatus(
  after: unknown,
): "ok" | "failed" | "pending" | "unknown" {
  if (after == null || typeof after !== "object") return "unknown";
  const a = after as Record<string, unknown>;
  if (a._failed === true) return "failed";
  if (a._pending === true) return "pending";
  return "ok";
}

export function getErrorMessage(after: unknown): string | null {
  if (after == null || typeof after !== "object") return null;
  const a = after as Record<string, unknown>;
  return typeof a._error === "string" ? a._error : null;
}

// Renders a before→after diff for the audit log row's most important field.
// For status changes that's `status`; for budget edits it's the cents field.
export function summarizeChange(
  action: string,
  before: unknown,
  after: unknown,
  currency: string | null,
): { field: string; from: string; to: string } | null {
  const kind = getActionKind(action);
  if (
    kind === "status" &&
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object"
  ) {
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    if (typeof b.status === "string" && typeof a.status === "string") {
      return { field: "status", from: b.status, to: a.status };
    }
  }
  if (kind === "budget" && before && after && typeof before === "object" && typeof after === "object") {
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    for (const key of ["dailyBudgetCents", "lifetimeBudgetCents"]) {
      if (typeof b[key] === "number" || typeof a[key] === "number") {
        const fromCents = typeof b[key] === "number" ? (b[key] as number) : null;
        const toCents = typeof a[key] === "number" ? (a[key] as number) : null;
        return {
          field: key === "dailyBudgetCents" ? "Daily budget" : "Lifetime budget",
          from: fromCents != null ? formatMoney(fromCents / 100, currency) : "—",
          to: toCents != null ? formatMoney(toCents / 100, currency) : "—",
        };
      }
    }
  }
  return null;
}

function formatMoney(amount: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency ?? ""}`.trim();
  }
}
