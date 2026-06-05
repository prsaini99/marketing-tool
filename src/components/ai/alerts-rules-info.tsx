"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";

/**
 * Info-icon-triggered modal that documents the alert detection rules.
 *
 * Lives next to the page H1 so the user can ask "what does this actually
 * check?" without the rules table consuming page real-estate. Content is
 * identical to the previous inline disclosure — just behind a click.
 */

export function AlertsRulesInfo() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

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
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="What anomalies the scanner looks for"
        title="What we look for"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground"
      >
        <Info className="h-4 w-4" />
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="alerts-rules-title"
              className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-background shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
                <div>
                  <h2
                    id="alerts-rules-title"
                    className="text-sm font-semibold tracking-tight"
                  >
                    What we look for
                  </h2>
                  <p className="mt-0.5 text-xs text-muted">
                    The exact rules the daily scanner applies — so &ldquo;0
                    alerts&rdquo; isn&apos;t ambiguous.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4 text-xs">
                <p className="text-muted">
                  For each account, yesterday&apos;s totals are compared
                  against the prior 7-day mean. An alert fires only when the
                  shift clears both a percentage <em>and</em> a base-size
                  threshold — that combination kills the noise tiny-base
                  accounts would otherwise generate.
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="text-left text-[11px] text-subtle">
                        <th className="border border-border bg-surface px-2 py-1 font-medium">
                          Anomaly
                        </th>
                        <th className="border border-border bg-surface px-2 py-1 font-medium">
                          What triggers it
                        </th>
                        <th className="border border-border bg-surface px-2 py-1 font-medium">
                          Severity
                        </th>
                      </tr>
                    </thead>
                    <tbody className="text-[11px] text-foreground">
                      <tr>
                        <td className="border border-border px-2 py-1 font-medium">
                          Delivery stopped
                        </td>
                        <td className="border border-border px-2 py-1 text-muted">
                          Yesterday&apos;s spend = 0 while the 7-day baseline
                          ≥ ₹500 / $5
                        </td>
                        <td className="border border-border px-2 py-1 text-red-700">
                          High
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-border px-2 py-1 font-medium">
                          Spend spike / drop
                        </td>
                        <td className="border border-border px-2 py-1 text-muted">
                          Spend changed ≥ 30% vs baseline (baseline ≥ ₹500 /
                          $5)
                        </td>
                        <td className="border border-border px-2 py-1 text-amber-700">
                          Medium ·{" "}
                          <span className="text-red-700">High</span> if ≥ 60%
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-border px-2 py-1 font-medium">
                          CTR spike / drop
                        </td>
                        <td className="border border-border px-2 py-1 text-muted">
                          CTR changed ≥ 30% (both windows had ≥ 1,000
                          impressions)
                        </td>
                        <td className="border border-border px-2 py-1 text-zinc-700">
                          Low ·{" "}
                          <span className="text-amber-700">Medium</span> if ≥
                          50%
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-border px-2 py-1 font-medium">
                          CPM spike / drop
                        </td>
                        <td className="border border-border px-2 py-1 text-muted">
                          CPM changed ≥ 30% (both windows had ≥ 1,000
                          impressions)
                        </td>
                        <td className="border border-border px-2 py-1 text-zinc-700">
                          Low ·{" "}
                          <span className="text-amber-700">Medium</span> if ≥
                          50%
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-border px-2 py-1 font-medium">
                          ROAS spike / drop
                        </td>
                        <td className="border border-border px-2 py-1 text-muted">
                          ROAS changed ≥ 30% (baseline revenue &gt; 0 — skips
                          accounts with no conversion tracking)
                        </td>
                        <td className="border border-border px-2 py-1 text-amber-700">
                          Medium · <span className="text-red-700">High</span>{" "}
                          if drop ≥ 50%
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-border px-2 py-1 font-medium">
                          Conversions spike / drop
                        </td>
                        <td className="border border-border px-2 py-1 text-muted">
                          Conversions changed ≥ 30% (baseline ≥ 5 conv/day
                          so tiny samples don&apos;t flag)
                        </td>
                        <td className="border border-border px-2 py-1 text-zinc-700">
                          Low ·{" "}
                          <span className="text-amber-700">Medium</span> if ≥
                          50%
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-border px-2 py-1 font-medium">
                          Conversions collapsed
                        </td>
                        <td className="border border-border px-2 py-1 text-muted">
                          Yesterday&apos;s conversions = 0 while baseline ≥ 5
                          /day
                        </td>
                        <td className="border border-border px-2 py-1 text-red-700">
                          High
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-border px-2 py-1 font-medium">
                          Ad-set spend / ROAS shift
                        </td>
                        <td className="border border-border px-2 py-1 text-muted">
                          Same ≥ 30% delta logic, but at ad-set level (catches
                          what account totals hide). Top 5 worst per account.
                        </td>
                        <td className="border border-border px-2 py-1 text-amber-700">
                          Medium · <span className="text-red-700">High</span>{" "}
                          if drop ≥ 50%
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-border px-2 py-1 font-medium">
                          Ad-set delivery stopped
                        </td>
                        <td className="border border-border px-2 py-1 text-muted">
                          Yesterday&apos;s spend = 0 while baseline ≥ ₹200 /
                          $2 (ad-set floor)
                        </td>
                        <td className="border border-border px-2 py-1 text-red-700">
                          High
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-border px-2 py-1 font-medium">
                          Ad disapproved / has issues
                        </td>
                        <td className="border border-border px-2 py-1 text-muted">
                          Meta&apos;s <code>effective_status</code> is
                          DISAPPROVED or WITH_ISSUES; body quotes Meta&apos;s
                          own message
                        </td>
                        <td className="border border-border px-2 py-1 text-red-700">
                          High ·{" "}
                          <span className="text-amber-700">Medium</span> for
                          WITH_ISSUES
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-border px-2 py-1 font-medium">
                          Audience overlap high
                        </td>
                        <td className="border border-border px-2 py-1 text-muted">
                          ≥ 30% overlap between top synced custom audiences
                          (size ≥ 1,000)
                        </td>
                        <td className="border border-border px-2 py-1 text-amber-700">
                          Medium · <span className="text-red-700">High</span>{" "}
                          if ≥ 50%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-muted">
                  <span className="font-medium text-foreground">
                    Coverage notes:
                  </span>{" "}
                  Ad-set scans take only the top 5 anomalies per account to
                  avoid inbox spam. Policy alerts capped at 10 per account.
                  Audience overlap checks the 5 most recently synced
                  audiences pairwise (lookalikes skipped as anchors —
                  Meta&apos;s rules).
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-border px-5 py-3 text-right">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
