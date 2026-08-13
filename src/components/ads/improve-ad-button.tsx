"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Copy,
  Loader2,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import type { CheckStatus } from "@/lib/preflight";

/**
 * "Improve this ad" — diagnosis, rewrite, and pre-flight in one modal.
 *
 * Copy-to-clipboard rather than a launch button, deliberately. Applying a
 * rewrite means three chained Meta writes (create creative → duplicate ad →
 * repoint duplicate) with no transaction across them, and a half-completed
 * run leaves a duplicate ad carrying the OLD copy — which looks like it
 * worked. Until that has a rollback story, the operator pastes into the
 * create-ad flow and confirms there, which is one audited write on a path
 * that already exists.
 *
 * The diagnosis shown here is computed from InsightsSnapshot, not narrated
 * by the model, so the numbers on screen are the account's real numbers.
 */

interface Variant {
  headline: string;
  primaryText: string;
  description: string;
}

interface Check {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
}

interface Result {
  ad: { metaAdId: string; name: string };
  original: { headline: string | null; primaryText: string | null };
  diagnosis: {
    spendCents: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cpaCents: number | null;
    accountCtr: number;
    accountCpaCents: number | null;
    daysWithData: number;
    windowEnd: string;
    windowDays: number;
    findings: string[];
    hookLabel: string | null;
  };
  variants: Variant[];
  preflight: {
    summary: { score: number | null; verdict: string; headline: string };
    checks: Check[];
  } | null;
  groundedIn: { voice: number; winners: number };
}

const ICON: Record<CheckStatus, typeof CheckCircle2> = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  skipped: CircleSlash,
};

const COLOR: Record<CheckStatus, string> = {
  pass: "text-success",
  warn: "text-warning",
  fail: "text-danger",
  skipped: "text-muted",
};

export function ImproveAdButton({
  metaAdId,
  adName,
  currencySymbol = "₹",
}: {
  metaAdId: string;
  adName: string;
  currencySymbol?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [open]);

  async function run() {
    setOpen(true);
    if (result || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/improve-ad", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metaAdId, count: 3 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to improve ad");
      setResult(json as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to improve ad");
    } finally {
      setLoading(false);
    }
  }

  async function copyVariant(v: Variant, i: number) {
    const text = [
      `Headline: ${v.headline}`,
      `Primary text: ${v.primaryText}`,
      v.description ? `Description: ${v.description}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  const money = (c: number) =>
    `${currencySymbol}${Math.round(c / 100).toLocaleString()}`;

  const trigger = (
    <button
      type="button"
      onClick={run}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2"
    >
      <Sparkles className="h-3.5 w-3.5" />
      Improve this ad
    </button>
  );

  if (!open || !mounted) return trigger;

  const d = result?.diagnosis;

  return (
    <>
      {trigger}
      {createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-background shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-background px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Improve this ad</h2>
                <p className="truncate text-xs text-muted">{adName}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-4 py-4">
              {loading && (
                <div className="flex items-center gap-2 py-8 text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Diagnosing, rewriting, and checking…
                </div>
              )}

              {error && <p className="text-sm text-danger">{error}</p>}

              {result && d && (
                <>
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                      What the numbers say
                    </h3>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <span>Spend {money(d.spendCents)}</span>
                      <span>{d.clicks.toLocaleString()} clicks</span>
                      <span>{d.conversions} conversions</span>
                      <span>CTR {(d.ctr * 100).toFixed(2)}%</span>
                      {d.cpaCents != null && <span>CPA {money(d.cpaCents)}</span>}
                    </div>
                    <ul className="mt-2 space-y-1">
                      {d.findings.map((f, i) => (
                        <li key={i} className="text-sm text-foreground">
                          • {f}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-xs text-muted">
                      {d.windowDays} days to {d.windowEnd} · {d.daysWithData}{" "}
                      day{d.daysWithData === 1 ? "" : "s"} with data
                    </p>
                  </section>

                  {result.original.headline && (
                    <section className="rounded-md border border-border bg-surface px-3 py-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Current
                      </h3>
                      <p className="mt-1 text-sm font-medium">
                        {result.original.headline}
                      </p>
                      {result.original.primaryText && (
                        <p className="mt-0.5 text-xs text-muted">
                          {result.original.primaryText}
                        </p>
                      )}
                    </section>
                  )}

                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Rewrites
                    </h3>
                    <p className="mt-0.5 text-xs text-muted">
                      Grounded in {result.groundedIn.voice} of this
                      account&apos;s ads
                      {result.groundedIn.winners > 0 &&
                        ` and ${result.groundedIn.winners} cross-account winners`}
                      .
                    </p>
                    <ul className="mt-2 space-y-2">
                      {result.variants.map((v, i) => (
                        <li
                          key={i}
                          className="rounded-md border border-border px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{v.headline}</p>
                              <p className="mt-0.5 text-xs text-muted">
                                {v.primaryText}
                              </p>
                              {v.description && (
                                <p className="mt-0.5 text-xs text-subtle">
                                  {v.description}
                                </p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => copyVariant(v, i)}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-2"
                            >
                              <Copy className="h-3 w-3" />
                              {copied === i ? "Copied" : "Copy"}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>

                  {result.preflight && (
                    <section className="rounded-md border border-border px-3 py-2">
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                          Pre-flight on rewrite 1
                        </h3>
                        {result.preflight.summary.score != null && (
                          <span className="text-sm font-semibold tabular-nums">
                            {result.preflight.summary.score}/100
                          </span>
                        )}
                      </div>
                      <ul className="mt-1.5 space-y-1">
                        {result.preflight.checks.map((c) => {
                          const Icon = ICON[c.status];
                          return (
                            <li key={c.id} className="flex gap-1.5 text-xs">
                              <Icon
                                className={`mt-0.5 h-3 w-3 shrink-0 ${COLOR[c.status]}`}
                              />
                              <span className="text-muted">
                                <span className="font-medium text-foreground">
                                  {c.title}:
                                </span>{" "}
                                {c.detail}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  )}

                  <p className="text-xs text-muted">
                    Copy a rewrite into the New Ad form to launch it. Nothing
                    here has changed anything on Meta.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
