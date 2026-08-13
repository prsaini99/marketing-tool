"use client";

import { useCallback, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { CheckStatus } from "@/lib/preflight";

/**
 * Pre-flight panel for the create-ad flow.
 *
 * Mounted BY create-ad-modal rather than written into it — that file is
 * already ~1,450 lines and is the hardest thing in the repo to change safely.
 *
 * Deliberately MANUAL, not reactive-on-keystroke. Each run costs two LLM
 * calls plus an embedding, so firing on every edit would burn money on
 * half-typed drafts and produce a verdict that flickers while the user is
 * still writing. The user asks when they are ready.
 *
 * This ADVISES, it never gates. There is no wiring here that can disable the
 * submit button: a screening step that blocks a launch on the judgement of a
 * language model would be worse than no screening at all, and the operator
 * is the one accountable for the ad.
 */

interface Check {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  evidence?: string[];
}

interface Summary {
  score: number | null;
  verdict: "ready" | "review" | "blocked";
  checksRun: number;
  checksSkipped: number;
  headline: string;
}

interface Result {
  summary: Summary;
  checks: Check[];
}

export interface PreflightDraft {
  adAccountId: string;
  primaryText?: string;
  headline?: string;
  description?: string;
  callToAction?: string;
  linkUrl?: string;
}

const STATUS_ICON: Record<CheckStatus, typeof CheckCircle2> = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  skipped: CircleSlash,
};

const STATUS_COLOR: Record<CheckStatus, string> = {
  pass: "text-success",
  warn: "text-warning",
  fail: "text-danger",
  skipped: "text-muted",
};

const VERDICT_COLOR: Record<Summary["verdict"], string> = {
  ready: "text-success",
  review: "text-warning",
  blocked: "text-danger",
};

export function PreflightPanel({ draft }: { draft: PreflightDraft }) {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCopy = Boolean(
    (draft.primaryText ?? "").trim() || (draft.headline ?? "").trim(),
  );

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Pre-flight failed");
      setResult(json as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pre-flight failed");
    } finally {
      setLoading(false);
    }
  }, [draft]);

  return (
    <section className="rounded-md border border-border">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-muted" />
          <span className="text-xs font-semibold">Pre-flight check</span>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={loading || !hasCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-2 disabled:opacity-40"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {loading ? "Checking…" : result ? "Re-check" : "Run check"}
        </button>
      </header>

      <div className="px-3 py-2.5">
        {!result && !loading && !error && (
          <p className="text-xs text-muted">
            {hasCopy
              ? "Check this draft for policy risk, likely performance, and creative fatigue before it goes to Meta."
              : "Add a headline or primary text to run a check."}
          </p>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}

        {result && (
          <>
            <div className="flex items-baseline gap-2">
              {result.summary.score != null && (
                <span className="text-lg font-semibold tabular-nums">
                  {result.summary.score}
                  <span className="text-xs font-normal text-muted">/100</span>
                </span>
              )}
              <span
                className={`text-xs font-medium ${VERDICT_COLOR[result.summary.verdict]}`}
              >
                {result.summary.headline}
              </span>
            </div>

            <ul className="mt-2.5 space-y-2">
              {result.checks.map((c) => {
                const Icon = STATUS_ICON[c.status];
                return (
                  <li key={c.id} className="flex gap-2">
                    <Icon
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${STATUS_COLOR[c.status]}`}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{c.title}</div>
                      <p className="text-xs text-muted">{c.detail}</p>
                      {c.evidence && c.evidence.length > 0 && (
                        <ul className="mt-0.5 space-y-0.5">
                          {c.evidence.map((e, i) => (
                            <li key={i} className="text-xs text-muted">
                              • {e}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <p className="mt-2.5 text-xs text-muted">
              {result.summary.checksRun} check
              {result.summary.checksRun === 1 ? "" : "s"} ran
              {result.summary.checksSkipped > 0 &&
                `, ${result.summary.checksSkipped} skipped (excluded from the score)`}
              . Advisory only, so you can still launch.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
