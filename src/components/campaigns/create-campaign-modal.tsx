"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Pause, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface AccountOption {
  metaAdAccountId: string; // "act_..."
  name: string;
  currency: string;
  businessName: string;
}

interface CreateCampaignModalProps {
  open: boolean;
  accounts: AccountOption[];
  // If set, the account picker is hidden and locked to this id.
  lockedAdAccountId?: string;
  onClose: () => void;
}

const OBJECTIVES = [
  { value: "OUTCOME_SALES", label: "Sales", hint: "Drive purchases or conversions on your site." },
  { value: "OUTCOME_LEADS", label: "Leads", hint: "Collect form submissions, calls, or messages." },
  { value: "OUTCOME_AWARENESS", label: "Awareness", hint: "Show your ads to people most likely to remember them." },
  { value: "OUTCOME_TRAFFIC", label: "Traffic", hint: "Send people to your website or app." },
  { value: "OUTCOME_ENGAGEMENT", label: "Engagement", hint: "Get likes, comments, video views, messages." },
  { value: "OUTCOME_APP_PROMOTION", label: "App promotion", hint: "Drive app installs or in-app actions." },
];

const SPECIAL_CATEGORIES = [
  { value: "NONE", label: "None", code: [] as string[] },
  { value: "CREDIT", label: "Credit", code: ["CREDIT"] },
  { value: "EMPLOYMENT", label: "Employment", code: ["EMPLOYMENT"] },
  { value: "HOUSING", label: "Housing", code: ["HOUSING"] },
  {
    value: "ISSUES_ELECTIONS_POLITICS",
    label: "Politics / Social Issues",
    code: ["ISSUES_ELECTIONS_POLITICS"],
  },
];

type BudgetType = "daily" | "lifetime";

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

export function CreateCampaignModal({
  open,
  accounts,
  lockedAdAccountId,
  onClose,
}: CreateCampaignModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Form state ─────────────────────────────────────────────────────────
  const initialAccount =
    lockedAdAccountId ?? accounts[0]?.metaAdAccountId ?? "";
  const [metaAdAccountId, setMetaAdAccountId] = useState(initialAccount);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("OUTCOME_SALES");
  const [specialCategory, setSpecialCategory] = useState("NONE");
  // CBO on by default — Meta's recommended pattern.
  const [cboOn, setCboOn] = useState(true);
  const [budgetType, setBudgetType] = useState<BudgetType>("daily");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [stopDate, setStopDate] = useState("");
  const [spendCapAmount, setSpendCapAmount] = useState("");
  // Default PAUSED — safest. User must flip to ACTIVE explicitly.
  const [status, setStatus] = useState<"PAUSED" | "ACTIVE">("PAUSED");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset form whenever the modal is reopened. Done on close so the next
  // open starts fresh without racing against the open-time effects.
  useEffect(() => {
    if (open) return;
    setName("");
    setObjective("OUTCOME_SALES");
    setSpecialCategory("NONE");
    setCboOn(true);
    setBudgetType("daily");
    setBudgetAmount("");
    setStopDate("");
    setSpendCapAmount("");
    setStatus("PAUSED");
    setShowAdvanced(false);
    setError(null);
    setMetaAdAccountId(lockedAdAccountId ?? accounts[0]?.metaAdAccountId ?? "");
  }, [open, lockedAdAccountId, accounts]);

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

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.metaAdAccountId === metaAdAccountId),
    [accounts, metaAdAccountId],
  );
  const currency = selectedAccount?.currency ?? "USD";

  // ── Validation ─────────────────────────────────────────────────────────
  const budgetCents = (() => {
    const n = Number.parseFloat(budgetAmount);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  })();
  const spendCapCents = (() => {
    if (!spendCapAmount) return null;
    const n = Number.parseFloat(spendCapAmount);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  })();
  const stopTimeIso = (() => {
    if (!stopDate) return null;
    // <input type="datetime-local"> gives "YYYY-MM-DDTHH:mm" (local TZ).
    // Treat as user's local time → convert to ISO.
    const d = new Date(stopDate);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  })();

  const validationError = (() => {
    if (!metaAdAccountId) return "Pick an ad account.";
    if (!name.trim()) return "Campaign name is required.";
    if (cboOn) {
      if (!budgetCents) return "Enter a positive budget amount.";
      if (budgetType === "lifetime" && !stopTimeIso) {
        return "End date is required for lifetime budgets.";
      }
    }
    if (spendCapAmount && !spendCapCents) {
      return "Spend cap must be a positive number (or leave blank).";
    }
    return null;
  })();

  // ── Meta payload preview ──────────────────────────────────────────────
  const specialCode =
    SPECIAL_CATEGORIES.find((c) => c.value === specialCategory)?.code ?? [];
  const previewPayload: Record<string, unknown> = {
    name: name || "(empty)",
    objective,
    status,
    special_ad_categories: specialCode,
  };
  if (cboOn && budgetCents) {
    if (budgetType === "daily") previewPayload.daily_budget = String(budgetCents);
    if (budgetType === "lifetime") {
      previewPayload.lifetime_budget = String(budgetCents);
      if (stopTimeIso) previewPayload.stop_time = stopTimeIso;
    }
    previewPayload.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
  }
  if (spendCapCents) {
    previewPayload.spend_cap = String(spendCapCents);
  }

  async function submit() {
    if (validationError) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metaAdAccountId,
          name: name.trim(),
          objective,
          status,
          specialAdCategories: specialCode,
          budgetType: cboOn ? budgetType : null,
          budgetCents: cboOn ? budgetCents : undefined,
          stopTime:
            cboOn && budgetType === "lifetime" ? stopTimeIso : undefined,
          spendCapCents: spendCapCents ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      // Success: close modal, refresh the page so the new row appears in any
      // visible campaigns table.
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
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
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-campaign-title"
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-background shadow-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h2
              id="create-campaign-title"
              className="text-sm font-semibold tracking-tight"
            >
              New campaign
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Created as <span className="font-medium text-foreground">PAUSED</span>{" "}
              by default — won&apos;t spend until you activate it.
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

        {/* Body: 2-column form + payload preview */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_320px]">
            {/* ── Form ─────────────────────────────────────────────── */}
            <div className="space-y-4 border-b border-border px-5 py-4 lg:border-b-0 lg:border-r">
              {/* Account picker */}
              {!lockedAdAccountId && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    Ad account <span className="text-danger">*</span>
                  </label>
                  <select
                    value={metaAdAccountId}
                    onChange={(e) => setMetaAdAccountId(e.target.value)}
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {accounts.map((a) => (
                      <option key={a.metaAdAccountId} value={a.metaAdAccountId}>
                        {a.businessName} · {a.name} ({a.currency})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {lockedAdAccountId && selectedAccount && (
                <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted">
                  Creating in{" "}
                  <span className="font-medium text-foreground">
                    {selectedAccount.name}
                  </span>{" "}
                  · {selectedAccount.businessName} · {currency}
                </div>
              )}

              {/* Name */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Campaign name <span className="text-danger">*</span>
                </label>
                <input
                  ref={firstFieldRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Q4 Sales Push — Diwali 2026"
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {/* Objective */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Objective <span className="text-danger">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {OBJECTIVES.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setObjective(o.value)}
                      disabled={submitting}
                      title={o.hint}
                      className={cn(
                        "rounded-md border px-2.5 py-2 text-left text-xs transition-colors disabled:opacity-50",
                        objective === o.value
                          ? "border-accent bg-accent-subtle text-foreground"
                          : "border-border bg-background text-muted hover:bg-surface-2 hover:text-foreground",
                      )}
                    >
                      <div className="font-medium">{o.label}</div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-subtle">
                        {o.hint}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Special ad category */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Special ad category <span className="text-danger">*</span>
                </label>
                <select
                  value={specialCategory}
                  onChange={(e) => setSpecialCategory(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {SPECIAL_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-subtle">
                  Meta legally requires this for credit, employment, housing,
                  and political ads. Use &quot;None&quot; otherwise.
                </p>
              </div>

              {/* CBO toggle */}
              <div className="rounded-md border border-border bg-surface px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground">
                      Advantage Campaign Budget (CBO)
                    </div>
                    <p className="mt-0.5 text-[11px] text-subtle">
                      Set budget at the campaign level — Meta distributes it
                      across ad sets automatically.{" "}
                      {cboOn
                        ? "Recommended."
                        : "Off: you'll set budgets per ad set instead."}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={cboOn}
                    onClick={() => setCboOn((v) => !v)}
                    disabled={submitting}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors",
                      cboOn ? "bg-accent" : "bg-zinc-300",
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition",
                        cboOn ? "translate-x-4" : "translate-x-0.5",
                      )}
                      style={{ marginTop: 1 }}
                    />
                  </button>
                </div>
              </div>

              {/* Budget (only when CBO is on) */}
              {cboOn && (
                <div className="space-y-3 rounded-md border border-border bg-background px-3 py-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Budget type
                    </label>
                    <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
                      {(["daily", "lifetime"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setBudgetType(t)}
                          disabled={submitting}
                          className={cn(
                            "rounded-sm px-2.5 py-1 font-medium transition-colors",
                            budgetType === t
                              ? "bg-surface-2 text-foreground"
                              : "text-muted hover:text-foreground",
                          )}
                        >
                          {t === "daily" ? "Daily" : "Lifetime"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Amount ({currency}){" "}
                      <span className="text-danger">*</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={budgetAmount}
                        onChange={(e) => setBudgetAmount(e.target.value)}
                        placeholder="1000"
                        disabled={submitting}
                        className="w-40 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <span className="text-xs text-muted">
                        {budgetType === "daily" ? "/ day" : "total over campaign"}
                      </span>
                    </div>
                    {budgetCents && (
                      <p className="text-[11px] text-subtle">
                        Sent to Meta as{" "}
                        <span className="font-mono text-foreground">
                          {budgetCents}
                        </span>{" "}
                        ({formatCurrency(budgetCents / 100, currency)}{" "}
                        {budgetType === "daily" ? "/ day" : "lifetime"})
                      </p>
                    )}
                  </div>
                  {budgetType === "lifetime" && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground">
                        End date <span className="text-danger">*</span>
                      </label>
                      <input
                        type="datetime-local"
                        value={stopDate}
                        onChange={(e) => setStopDate(e.target.value)}
                        disabled={submitting}
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  )}
                  <p className="text-[11px] text-subtle">
                    Bid strategy: <span className="text-foreground">Highest volume</span>{" "}
                    (default). Advanced strategies can be set in Meta later.
                  </p>
                </div>
              )}

              {/* Advanced */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="text-xs text-muted hover:text-foreground"
                >
                  {showAdvanced ? "Hide advanced ▴" : "Show advanced ▾"}
                </button>
                {showAdvanced && (
                  <div className="mt-2 space-y-3 rounded-md border border-border bg-surface px-3 py-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground">
                        Spend cap ({currency})
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={spendCapAmount}
                        onChange={(e) => setSpendCapAmount(e.target.value)}
                        placeholder="Leave blank for no cap"
                        disabled={submitting}
                        className="w-40 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <p className="text-[11px] text-subtle">
                        Hard limit Meta will never spend past, total across the
                        campaign&apos;s entire run.
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground">
                        Start status
                      </label>
                      <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
                        {(["PAUSED", "ACTIVE"] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setStatus(s)}
                            disabled={submitting}
                            className={cn(
                              "rounded-sm px-2.5 py-1 font-medium transition-colors",
                              status === s
                                ? s === "ACTIVE"
                                  ? "bg-red-50 text-red-700"
                                  : "bg-surface-2 text-foreground"
                                : "text-muted hover:text-foreground",
                            )}
                          >
                            {s === "PAUSED" ? "Paused" : "Active"}
                          </button>
                        ))}
                      </div>
                      {status === "ACTIVE" && (
                        <p className="mt-1 flex items-start gap-1 text-[11px] text-danger">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          Campaign will start spending immediately if at least
                          one ad set + ad exists.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Payload preview ─────────────────────────────────── */}
            <div className="bg-surface px-5 py-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">
                Meta payload
              </div>
              <p className="mt-0.5 text-[11px] text-subtle">
                Exactly what will hit Meta&apos;s{" "}
                <span className="font-mono">POST /act_*/campaigns</span>.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-background p-3 text-[11px] leading-relaxed text-foreground">
                {JSON.stringify(previewPayload, null, 2)}
              </pre>
              <div className="mt-3 space-y-1 text-[11px] text-subtle">
                <div className="flex justify-between">
                  <span>Status on create</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-medium",
                      status === "PAUSED" ? "text-amber-700" : "text-red-700",
                    )}
                  >
                    <Pause className="h-3 w-3" />
                    {status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Audit log</span>
                  <span className="text-foreground">
                    campaign.create row written
                  </span>
                </div>
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
              {validationError ?? "Ready to send."}
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
                {submitting
                  ? "Creating…"
                  : status === "PAUSED"
                    ? "Create paused campaign"
                    : "Create active campaign"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
