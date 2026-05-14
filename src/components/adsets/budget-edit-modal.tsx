"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlatDisplayAdSet } from "@/lib/display";

interface AdSetBudgetEditModalProps {
  open: boolean;
  selectedAdSets: FlatDisplayAdSet[];
  onClose: () => void;
  onDone: () => void;
}

type BudgetType = "daily" | "lifetime";
type Mode = "absolute" | "percent";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function readBudgetCents(s: FlatDisplayAdSet, type: BudgetType): number | null {
  return type === "daily"
    ? (s.dailyBudgetCents ?? null)
    : (s.lifetimeBudgetCents ?? null);
}

export function AdSetBudgetEditModal({
  open,
  selectedAdSets,
  onClose,
  onDone,
}: AdSetBudgetEditModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [budgetType, setBudgetType] = useState<BudgetType>("daily");
  const [mode, setMode] = useState<Mode>("absolute");
  const [amount, setAmount] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const eligibleDaily = useMemo(
    () => selectedAdSets.filter((s) => s.dailyBudgetCents != null),
    [selectedAdSets],
  );
  const eligibleLifetime = useMemo(
    () => selectedAdSets.filter((s) => s.lifetimeBudgetCents != null),
    [selectedAdSets],
  );

  useEffect(() => {
    if (!open) return;
    if (eligibleDaily.length === 0 && eligibleLifetime.length > 0) {
      setBudgetType("lifetime");
    } else {
      setBudgetType("daily");
    }
  }, [open, eligibleDaily.length, eligibleLifetime.length]);

  const eligible = budgetType === "daily" ? eligibleDaily : eligibleLifetime;
  const skippedCount = selectedAdSets.length - eligible.length;

  const currencies = useMemo(
    () => new Set(eligible.map((s) => s.currency)),
    [eligible],
  );
  const mixedCurrencies = currencies.size > 1;
  const singleCurrency =
    currencies.size === 1 ? Array.from(currencies)[0] : null;

  useEffect(() => {
    if (open && mixedCurrencies && mode === "absolute") {
      setMode("percent");
    }
  }, [open, mixedCurrencies, mode]);

  useEffect(() => {
    setMounted(true);
  }, []);

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
      if (e.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setAmount("");
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, budgetType, mode]);

  const amountNum = Number.parseFloat(amount);
  const amountValid =
    Number.isFinite(amountNum) &&
    amountNum !== 0 &&
    (mode === "percent" || amountNum > 0);

  const previews = eligible.map((s) => {
    const fromCents = readBudgetCents(s, budgetType)!;
    let toCents: number | null = null;
    if (amountValid) {
      if (mode === "absolute") {
        toCents = Math.round(amountNum * 100);
      } else {
        toCents = Math.max(1, Math.round(fromCents * (1 + amountNum / 100)));
      }
    }
    return { adSet: s, fromCents, toCents };
  });

  const bigJump = previews.some(
    (p) =>
      p.toCents != null &&
      p.fromCents > 0 &&
      (p.toCents / p.fromCents > 5 || p.toCents / p.fromCents < 0.2),
  );

  async function save() {
    if (!amountValid) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        metaAdSetIds: eligible.map((s) => s.id),
        budgetType,
      };
      if (mode === "absolute") body.setAbsoluteCents = Math.round(amountNum * 100);
      else body.adjustPercent = amountNum;

      const res = await fetch("/api/adsets/bulk-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);

      if (data.failed > 0) {
        setError(
          `Done: ${data.ok} updated · ${data.failed} failed${
            data.skipped ? ` · ${data.skipped} skipped` : ""
          }`,
        );
        router.refresh();
      } else {
        onDone();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (!mounted || !open) return null;

  const typeLabel = budgetType === "daily" ? "daily" : "lifetime";

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
        aria-labelledby="adset-budget-modal-title"
        className="w-full max-w-xl rounded-lg border border-border bg-background shadow-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h2
              id="adset-budget-modal-title"
              className="text-sm font-semibold tracking-tight"
            >
              Edit {typeLabel} budget
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {eligible.length} of {selectedAdSets.length} selected ad set
              {selectedAdSets.length === 1 ? "" : "s"} eligible
              {skippedCount > 0 &&
                ` · ${skippedCount} without ${typeLabel} budget will be skipped`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
            {(["daily", "lifetime"] as const).map((t) => {
              const count =
                t === "daily" ? eligibleDaily.length : eligibleLifetime.length;
              const disabled = count === 0;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setBudgetType(t)}
                  disabled={disabled}
                  title={
                    disabled
                      ? `No selected ad sets have a ${t} budget`
                      : undefined
                  }
                  className={cn(
                    "rounded-sm px-2.5 py-1 font-medium transition-colors",
                    budgetType === t
                      ? "bg-surface-2 text-foreground"
                      : "text-muted hover:text-foreground",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  {t === "daily" ? "Daily" : "Lifetime"}{" "}
                  <span className="text-subtle">({count})</span>
                </button>
              );
            })}
          </div>

          {eligible.length === 0 ? (
            <p className="mt-4 rounded-md border border-dashed border-border bg-surface px-3 py-6 text-center text-sm text-subtle">
              None of the selected ad sets has a {typeLabel} budget. Switch
              tabs or pick a different selection.
            </p>
          ) : (
            <>
              <div className="mt-3 inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setMode("absolute")}
                  disabled={mixedCurrencies}
                  title={
                    mixedCurrencies
                      ? "Selection spans multiple currencies — use % mode"
                      : undefined
                  }
                  className={cn(
                    "rounded-sm px-2.5 py-1 font-medium transition-colors",
                    mode === "absolute"
                      ? "bg-surface-2 text-foreground"
                      : "text-muted hover:text-foreground",
                    mixedCurrencies && "cursor-not-allowed opacity-50",
                  )}
                >
                  Set amount
                </button>
                <button
                  type="button"
                  onClick={() => setMode("percent")}
                  className={cn(
                    "rounded-sm px-2.5 py-1 font-medium transition-colors",
                    mode === "percent"
                      ? "bg-surface-2 text-foreground"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  Adjust by %
                </button>
              </div>

              <div className="mt-4">
                {mode === "absolute" ? (
                  <label className="block">
                    <span className="text-xs font-medium text-muted">
                      New {typeLabel} budget ({singleCurrency ?? "USD"})
                    </span>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        ref={inputRef}
                        type="text"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="5000"
                        disabled={saving}
                        className="w-40 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <span className="text-xs text-muted">
                        {budgetType === "daily" ? "/ day" : "total"}
                      </span>
                    </div>
                  </label>
                ) : (
                  <label className="block">
                    <span className="text-xs font-medium text-muted">
                      Adjust by % (negative to decrease)
                    </span>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        ref={inputRef}
                        type="text"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="20"
                        disabled={saving}
                        className="w-32 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <span className="text-xs text-muted">%</span>
                    </div>
                    <p className="mt-1 text-[11px] text-subtle">
                      e.g. <code className="rounded bg-surface px-1">20</code> for
                      +20% · <code className="rounded bg-surface px-1">-10</code> for −10%
                    </p>
                  </label>
                )}
              </div>

              <div className="mt-4 rounded-md border border-border">
                <div className="border-b border-border bg-surface px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle">
                  Preview
                </div>
                <ul className="max-h-56 divide-y divide-border overflow-y-auto">
                  {previews.slice(0, 8).map((p) => (
                    <li
                      key={p.adSet.id}
                      className="flex items-center justify-between gap-4 px-3 py-1.5 text-xs"
                    >
                      <span className="truncate text-foreground">
                        {p.adSet.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted">
                        {formatMoney(p.fromCents / 100, p.adSet.currency)} →{" "}
                        {p.toCents != null ? (
                          <span className="font-medium text-foreground">
                            {formatMoney(p.toCents / 100, p.adSet.currency)}
                          </span>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </span>
                    </li>
                  ))}
                  {previews.length > 8 && (
                    <li className="px-3 py-1.5 text-xs text-subtle">
                      + {previews.length - 8} more
                    </li>
                  )}
                </ul>
              </div>

              {bigJump && amountValid && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Some ad sets will change by more than 5×. Double-check
                    before confirming — money spent on Meta cannot be recovered.
                  </span>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-[11px] text-subtle">
            Changes hit Meta immediately. Every ad set is audit-logged.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !amountValid || eligible.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "Updating..." : "Update"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
