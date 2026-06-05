"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ClipboardCheck,
  Copy,
  Download,
  Loader2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * AuditPanel — client-side renderer for the auto-account audit.
 *
 * Run button → POST /api/ai/audit/run → 5–30s wait → executive summary +
 * categorised findings table. Copy and Download buttons mirror Reports so
 * the strategist can paste the audit into Slack / a client doc.
 */

interface AuditFinding {
  kind:
    | "budget_misallocation"
    | "naming_inconsistency"
    | "url_utm"
    | "voice_drift";
  severity: "high" | "medium" | "low" | "info";
  title: string;
  body: string;
  entity?: { type: string; id: string; name: string; navUrl?: string };
}

interface AuditResult {
  id: string;
  metaAdAccountId: string;
  accountName: string;
  businessName: string;
  generatedAt: string;
  windowDays: number;
  findings: AuditFinding[];
  summary: string;
  stats: { high: number; medium: number; low: number; info: number };
}

interface AuditPanelProps {
  metaAdAccountId: string;
  accountName: string;
  /**
   * Latest persisted audit for this account, fetched server-side so the
   * page lands rendered. Null on first-ever visit (or when the audit row
   * was deleted). Re-running replaces what's shown.
   */
  initialResult: AuditResult | null;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)} days ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    month: "short",
    day: "numeric",
  });
}

const KIND_LABEL: Record<AuditFinding["kind"], string> = {
  budget_misallocation: "Budget",
  naming_inconsistency: "Naming",
  url_utm: "Tracking",
  voice_drift: "Brand voice",
};

function severityStyles(s: AuditFinding["severity"]) {
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

function findingsToMarkdown(r: AuditResult): string {
  const lines: string[] = [];
  lines.push(`# Audit · ${r.businessName} — ${r.accountName}`);
  lines.push("");
  lines.push(
    `_Generated ${new Date(r.generatedAt).toLocaleString()} · window: last ${r.windowDays} days_`,
  );
  lines.push("");
  lines.push("## Summary");
  lines.push(r.summary);
  lines.push("");
  lines.push(
    `**Findings:** ${r.stats.high} high · ${r.stats.medium} medium · ${r.stats.low} low · ${r.stats.info} info`,
  );
  lines.push("");
  for (const f of r.findings) {
    lines.push(`### [${f.severity.toUpperCase()}] ${f.title}`);
    lines.push(`_(${KIND_LABEL[f.kind]})_`);
    lines.push("");
    lines.push(f.body);
    lines.push("");
  }
  return lines.join("\n");
}

export function AuditPanel({
  metaAdAccountId,
  accountName,
  initialResult,
}: AuditPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AuditResult | null>(initialResult);
  const [copied, setCopied] = useState(false);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/ai/audit/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: metaAdAccountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setResult(data as AuditResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audit failed");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(findingsToMarkdown(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  function download() {
    if (!result) return;
    const blob = new Blob([findingsToMarkdown(result)], {
      type: "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${accountName.replace(/[^\w-]+/g, "_")}_audit_${result.generatedAt.slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3">
        <div>
          <div className="text-sm font-medium text-foreground">
            Account audit
          </div>
          <p className="text-xs text-muted">
            {result
              ? `Last run ${formatRelative(result.generatedAt)} · scans budget, naming, URL/UTM, brand voice. Saved for later reference.`
              : "Scans budget allocation, naming, URL/UTM tracking, and brand-voice drift. ~5–30 s · costs ~₹0.50–1 per run."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <>
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={download}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2"
              >
                <Download className="h-3.5 w-3.5" />
                Download .md
              </button>
            </>
          )}
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {busy
              ? "Running audit…"
              : result
                ? "Re-run audit"
                : "Run audit"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!result && !busy && (
        <div className="rounded-md border border-dashed border-border bg-surface px-6 py-10 text-center">
          <ClipboardCheck className="mx-auto h-7 w-7 text-subtle" />
          <p className="mt-2 text-sm font-medium text-foreground">
            No audit run yet
          </p>
          <p className="mt-1 text-xs text-muted">
            Click <span className="font-medium">Run audit</span> above to scan{" "}
            <span className="text-foreground">{accountName}</span> for budget,
            naming, tracking, and brand-voice issues.
          </p>
        </div>
      )}

      {/* Busy state */}
      {busy && !result && (
        <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border bg-surface px-6 py-10 text-xs text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Running checks (budget · naming · URLs · brand voice)…
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          {/* Summary */}
          <article className="rounded-md border border-border bg-background px-5 py-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">
              Executive summary
            </div>
            <p className="mt-1 text-sm leading-6 text-foreground">
              {result.summary}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted">
              <span>
                <span className="font-semibold text-red-700">
                  {result.stats.high}
                </span>{" "}
                high
              </span>
              <span>
                <span className="font-semibold text-amber-700">
                  {result.stats.medium}
                </span>{" "}
                medium
              </span>
              <span>
                <span className="font-semibold text-zinc-700">
                  {result.stats.low}
                </span>{" "}
                low
              </span>
              <span className="text-subtle">
                · last {result.windowDays} days · generated{" "}
                {new Date(result.generatedAt).toLocaleTimeString()}
              </span>
            </div>
          </article>

          {/* Findings */}
          {result.findings.length === 0 ? (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-6 text-center">
              <Check className="mx-auto h-6 w-6 text-green-700" />
              <p className="mt-1 text-sm font-medium text-green-800">
                All clear — no issues flagged
              </p>
              <p className="mt-0.5 text-xs text-green-700">
                Naming, budget, tracking, and brand voice all look healthy.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {result.findings.map((f, i) => {
                const s = severityStyles(f.severity);
                const href = f.entity?.navUrl;
                // Inner content shared between the <a>-wrapped and the
                // unlinked variant — avoids duplicating the markup.
                const inner = (
                  <>
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
                      <span className="inline-flex items-center rounded-full bg-surface px-1.5 py-0.5 font-medium text-muted">
                        {KIND_LABEL[f.kind]}
                      </span>
                      {f.entity && (
                        <span className="text-subtle">
                          · {f.entity.type}
                        </span>
                      )}
                      {href && (
                        <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-accent">
                          Fix
                          <ArrowUpRight className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1.5 text-sm font-semibold text-foreground">
                      {f.title}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      {f.body}
                    </p>
                  </>
                );

                const baseClass = cn(
                  "block rounded-md border border-border border-l-4 bg-background px-4 py-3",
                  s.rail,
                );

                return (
                  <li key={i}>
                    {href ? (
                      <Link
                        href={href}
                        className={cn(
                          baseClass,
                          "transition-colors hover:bg-surface hover:border-l-accent",
                        )}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className={baseClass}>{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
