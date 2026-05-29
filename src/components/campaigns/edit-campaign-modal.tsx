"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Edit Campaign modal. Pre-fills from the campaign's current values and
 * sends only the diff to PATCH /api/campaigns/[id]. The right pane shows a
 * live "what will change" payload so the operator (and senior auditing the
 * tool) can see exactly what hits Meta before clicking save.
 *
 * Editable: name, status (Active/Paused), budget (CBO campaigns only),
 * spend cap. Objective is read-only — Meta locks it after creation.
 */

export interface EditableCampaign {
  metaCampaignId: string;
  name: string;
  status: string;
  objective: string;
  dailyBudgetCents: number | null;
  lifetimeBudgetCents: number | null;
  spendCapCents: number | null;
}

interface EditCampaignModalProps {
  open: boolean;
  campaign: EditableCampaign;
  currency: string;
  onClose: () => void;
}

function centsToInput(cents: number | null): string {
  if (cents == null || cents <= 0) return "";
  return String(cents / 100);
}

function inputToCents(v: string): number | null {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency}`;
  }
}

export function EditCampaignModal({
  open,
  campaign,
  currency,
  onClose,
}: EditCampaignModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // CBO = campaign owns a budget (vs. budget set per ad set).
  const hasCbo =
    campaign.dailyBudgetCents != null || campaign.lifetimeBudgetCents != null;
  const budgetType: "daily" | "lifetime" =
    campaign.lifetimeBudgetCents != null ? "lifetime" : "daily";
  const currentBudgetCents =
    budgetType === "lifetime"
      ? campaign.lifetimeBudgetCents
      : campaign.dailyBudgetCents;

  // ── Form state, seeded from current values ────────────────────────────
  const [name, setName] = useState(campaign.name);
  const [status, setStatus] = useState<"ACTIVE" | "PAUSED">(
    campaign.status === "ACTIVE" ? "ACTIVE" : "PAUSED",
  );
  const [budgetAmount, setBudgetAmount] = useState(
    centsToInput(currentBudgetCents),
  );
  const [spendCapAmount, setSpendCapAmount] = useState(
    centsToInput(campaign.spendCapCents),
  );

  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  // Re-seed whenever the modal (re)opens, so editing campaign A then B
  // doesn't carry A's edits into B's form.
  useEffect(() => {
    if (!open) return;
    setName(campaign.name);
    setStatus(campaign.status === "ACTIVE" ? "ACTIVE" : "PAUSED");
    setBudgetAmount(centsToInput(currentBudgetCents));
    setSpendCapAmount(centsToInput(campaign.spendCapCents));
    setError(null);
  }, [
    open,
    campaign.name,
    campaign.status,
    currentBudgetCents,
    campaign.spendCapCents,
  ]);

  useEffect(() => {
    if (!open) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => firstFieldRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // ── Diff computation ──────────────────────────────────────────────────
  const trimmedName = name.trim();
  const newBudgetCents = inputToCents(budgetAmount);
  const newSpendCapCents = inputToCents(spendCapAmount);

  const changes: Record<string, unknown> = {};
  if (trimmedName && trimmedName !== campaign.name) {
    changes.name = trimmedName;
  }
  if (status !== campaign.status) {
    changes.status = status;
  }
  if (
    hasCbo &&
    newBudgetCents != null &&
    newBudgetCents !== currentBudgetCents
  ) {
    changes[budgetType === "daily" ? "daily_budget" : "lifetime_budget"] =
      String(newBudgetCents);
  }
  if (
    newSpendCapCents != null &&
    newSpendCapCents !== (campaign.spendCapCents ?? 0)
  ) {
    changes.spend_cap = String(newSpendCapCents);
  }

  const hasChanges = Object.keys(changes).length > 0;

  const validationError = (() => {
    if (!trimmedName) return "Campaign name can't be empty.";
    if (hasCbo && budgetAmount.trim() && newBudgetCents == null) {
      return "Budget must be a positive number.";
    }
    if (hasCbo && newBudgetCents != null && newBudgetCents <= 0) {
      return "Budget must be greater than zero.";
    }
    if (spendCapAmount.trim() && newSpendCapCents == null) {
      return "Spend cap must be a number.";
    }
    if (!hasChanges) return "No changes yet.";
    return null;
  })();

  async function submit() {
    if (validationError) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (changes.name) body.name = changes.name;
      if (changes.status) body.status = changes.status;
      if (changes.daily_budget) {
        body.budgetType = "daily";
        body.budgetCents = newBudgetCents;
      }
      if (changes.lifetime_budget) {
        body.budgetType = "lifetime";
        body.budgetCents = newBudgetCents;
      }
      if (changes.spend_cap) {
        body.spendCapCents = newSpendCapCents;
      }
      const res = await fetch(
        `/api/campaigns/${encodeURIComponent(campaign.metaCampaignId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update campaign");
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-campaign-title"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-background shadow-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h2
              id="edit-campaign-title"
              className="text-sm font-semibold tracking-tight"
            >
              Edit campaign
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted">
              {campaign.name} ·{" "}
              <span className="font-mono">{campaign.metaCampaignId}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_300px]">
            {/* Form */}
            <div className="space-y-4 border-b border-border px-5 py-4 lg:border-b-0 lg:border-r">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Campaign name
                </label>
                <input
                  ref={firstFieldRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Status
                </label>
                <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
                  {(["ACTIVE", "PAUSED"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatus(s)}
                      disabled={submitting}
                      className={cn(
                        "rounded-sm px-2.5 py-1 font-medium transition-colors",
                        status === s
                          ? s === "ACTIVE"
                            ? "bg-green-50 text-green-700"
                            : "bg-surface-2 text-foreground"
                          : "text-muted hover:text-foreground",
                      )}
                    >
                      {s === "ACTIVE" ? "Active" : "Paused"}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-subtle">
                  Archiving is handled from the bulk actions, not here.
                </p>
              </div>

              {/* Budget — only for CBO campaigns. */}
              {hasCbo ? (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    {budgetType === "daily" ? "Daily" : "Lifetime"} budget (
                    {currency})
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={budgetAmount}
                    onChange={(e) => setBudgetAmount(e.target.value)}
                    disabled={submitting}
                    className="w-40 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <p className="text-[11px] text-subtle">
                    Campaign Budget Optimization is on — this budget is shared
                    across the campaign&apos;s ad sets.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-muted">
                  Budget is set per ad set on this campaign (no CBO). Edit ad
                  set budgets from the ad sets table.
                </div>
              )}

              {/* Spend cap */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Spend cap ({currency})
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={spendCapAmount}
                  onChange={(e) => setSpendCapAmount(e.target.value)}
                  placeholder="No cap"
                  disabled={submitting}
                  className="w-40 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <p className="text-[11px] text-subtle">
                  Lifetime ceiling on total campaign spend. Leave blank for no
                  cap. Meta won&apos;t let you set a cap below what&apos;s
                  already been spent.
                </p>
              </div>

              {/* Read-only objective for context */}
              <div className="rounded-md border border-dashed border-border bg-surface px-3 py-2 text-[11px] text-subtle">
                Objective:{" "}
                <span className="font-medium text-foreground">
                  {campaign.objective || "—"}
                </span>{" "}
                · locked by Meta after creation, can&apos;t be changed.
              </div>
            </div>

            {/* Diff preview */}
            <div className="bg-surface px-5 py-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">
                What will change
              </div>
              <p className="mt-0.5 text-[11px] text-subtle">
                Only the diff is sent to{" "}
                <span className="font-mono">PATCH /{campaign.metaCampaignId}</span>.
              </p>
              {hasChanges ? (
                <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-background p-3 text-[11px] leading-relaxed text-foreground">
                  {JSON.stringify(changes, null, 2)}
                </pre>
              ) : (
                <p className="mt-3 rounded-md border border-dashed border-border bg-background px-3 py-2 text-[11px] text-muted">
                  No changes yet — edit a field to see the payload.
                </p>
              )}
              {hasCbo &&
                newBudgetCents != null &&
                newBudgetCents !== currentBudgetCents && (
                  <p className="mt-2 text-[11px] text-subtle">
                    New budget:{" "}
                    {formatCurrency(newBudgetCents / 100, currency)}{" "}
                    {budgetType === "daily" ? "/ day" : "lifetime"}
                  </p>
                )}
              <div className="mt-3 text-[11px] text-subtle">
                Audit log: campaign.update row written with before/after.
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3">
          {error && (
            <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-subtle">
              {validationError ?? "Ready to save."}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || Boolean(validationError)}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {submitting ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
