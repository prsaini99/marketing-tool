"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Loader2,
  RefreshCw,
  Sparkles,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Client-side surface for the Alerts page.
 *
 * Holds the displayed list in local state so dismiss / undo / scan-now
 * feel instant. Calls router.refresh() after destructive ops so the
 * sidebar badge in the layout re-queries — same trick we use on Reports.
 */

export interface AlertWithAccount {
  id: string;
  forDate: string; // ISO date
  severity: string;
  kind: string;
  title: string;
  body: string;
  dismissedAt: string | null;
  createdAt: string;
  adAccount: {
    metaAdAccountId: string;
    name: string;
    currency: string;
    business: { id: string; name: string };
  };
}

interface AlertsListProps {
  initialAlerts: AlertWithAccount[];
  initialShowDismissed: boolean;
}

function severityStyles(s: string): {
  pill: string;
  rail: string;
  label: string;
} {
  switch (s) {
    case "high":
      return {
        pill: "bg-red-50 text-red-700 border-red-200",
        rail: "border-l-red-500",
        label: "High",
      };
    case "medium":
      return {
        pill: "bg-amber-50 text-amber-700 border-amber-200",
        rail: "border-l-amber-500",
        label: "Medium",
      };
    case "low":
      return {
        pill: "bg-zinc-100 text-zinc-700 border-zinc-200",
        rail: "border-l-zinc-400",
        label: "Low",
      };
    default:
      return {
        pill: "bg-blue-50 text-blue-700 border-blue-200",
        rail: "border-l-blue-400",
        label: "Info",
      };
  }
}

function severityRank(s: string): number {
  return s === "high" ? 0 : s === "medium" ? 1 : s === "low" ? 2 : 3;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)} days ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(d);
}

export function AlertsList({
  initialAlerts,
  initialShowDismissed,
}: AlertsListProps) {
  const router = useRouter();
  const [alerts, setAlerts] = useState(initialAlerts);
  const [showDismissed, setShowDismissed] = useState(initialShowDismissed);
  const [scanning, setScanning] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<{
    accountsScanned: number;
    totalAnomalies: number;
  } | null>(null);

  async function runScan() {
    if (scanning) return;
    setScanning(true);
    setScanError(null);
    setScanResult(null);
    try {
      const res = await fetch("/api/alerts/scan-now", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setScanResult({
        accountsScanned: data.accountsScanned ?? 0,
        totalAnomalies: data.totalAnomalies ?? 0,
      });
      // Re-fetch the list — easier than reconciling upserts client-side.
      await reload(showDismissed);
      router.refresh();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function reload(includeDismissed: boolean) {
    const r = await fetch(
      `/api/alerts${includeDismissed ? "?all=1" : ""}`,
    );
    const d = await r.json();
    if (Array.isArray(d.alerts)) setAlerts(d.alerts);
  }

  async function toggleShowDismissed() {
    const next = !showDismissed;
    setShowDismissed(next);
    await reload(next);
  }

  async function dismiss(id: string, undo: boolean) {
    setBusyIds((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/alerts/${id}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ undo }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Update local state immediately.
      setAlerts((curr) => {
        if (showDismissed) {
          return curr.map((a) =>
            a.id === id
              ? { ...a, dismissedAt: undo ? null : new Date().toISOString() }
              : a,
          );
        }
        // Active-only view: dropping a dismiss means removing from the list.
        return curr.filter((a) => a.id !== id);
      });
      router.refresh(); // refresh layout badge
    } catch {
      // Silent — user can try again
    } finally {
      setBusyIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  const sorted = [...alerts].sort((a, b) => {
    const sevDiff = severityRank(a.severity) - severityRank(b.severity);
    if (sevDiff !== 0) return sevDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const activeCount = alerts.filter((a) => !a.dismissedAt).length;

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3">
        <div className="text-xs text-muted">
          <span className="font-semibold text-foreground">{activeCount}</span>{" "}
          active alert{activeCount === 1 ? "" : "s"}
          {showDismissed && alerts.length > activeCount && (
            <> · {alerts.length - activeCount} dismissed shown</>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleShowDismissed}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2"
          >
            {showDismissed ? "Hide dismissed" : "Show dismissed"}
          </button>
          <button
            type="button"
            onClick={runScan}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scanning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {scanning ? "Scanning…" : "Run scan now"}
          </button>
        </div>
      </div>

      {/* Scan feedback */}
      {scanError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
          {scanError}
        </div>
      )}
      {scanResult && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          Scanned {scanResult.accountsScanned} account
          {scanResult.accountsScanned === 1 ? "" : "s"}, found{" "}
          {scanResult.totalAnomalies} anomal
          {scanResult.totalAnomalies === 1 ? "y" : "ies"}.
        </div>
      )}

      {/* List */}
      {sorted.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-surface px-6 py-10 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-subtle" />
          <p className="mt-2 text-sm font-medium text-foreground">
            {showDismissed ? "No alerts" : "All clear — no active alerts"}
          </p>
          <p className="mt-1 text-xs text-muted">
            {showDismissed
              ? "Nothing has been flagged or dismissed yet."
              : "Either nothing tripped the thresholds, or no scan has run yet. Click Run scan now to check the latest data."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map((a) => {
            const s = severityStyles(a.severity);
            const dismissed = Boolean(a.dismissedAt);
            const busy = busyIds.has(a.id);
            return (
              <li
                key={a.id}
                className={cn(
                  "rounded-md border border-border border-l-4 bg-background px-4 py-3",
                  s.rail,
                  dismissed && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-1.5 py-0.5 font-medium",
                          s.pill,
                        )}
                      >
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        {s.label}
                      </span>
                      <span className="text-muted">
                        <span className="font-medium text-foreground">
                          {a.adAccount.business.name}
                        </span>{" "}
                        · {a.adAccount.name}
                      </span>
                      <span className="text-subtle">·</span>
                      <span className="text-subtle">
                        for {a.forDate.slice(0, 10)}
                      </span>
                      <span className="text-subtle">·</span>
                      <span className="text-subtle">
                        {formatRelative(a.createdAt)}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {a.title}
                    </h3>
                    <p className="text-sm leading-6 text-muted">{a.body}</p>
                  </div>
                  <div className="shrink-0">
                    {dismissed ? (
                      <button
                        type="button"
                        onClick={() => dismiss(a.id, true)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-surface-2 disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Undo2 className="h-3 w-3" />
                        )}
                        Undo
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => dismiss(a.id, false)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-surface-2 disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-subtle">
        Scanner runs automatically once a day. Adjust the schedule in{" "}
        <span className="font-mono">vercel.json</span> if you want a different
        time.
      </p>
    </div>
  );
}
