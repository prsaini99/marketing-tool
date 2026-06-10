"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Loader2,
  Sparkles,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * One row in the cross-account Reports list. Owns its own generation state
 * so the user can fire off Generate on multiple rows in parallel (the
 * Monday-morning agency flow: pull every client's report in one sitting).
 *
 * Expanded-by-default once a result lands; collapse/expand chevron is
 * disabled until there's something to show.
 */

interface ReportContext {
  periods: {
    current: { from: string; to: string };
    previous: { from: string; to: string };
  };
  totals: {
    current: {
      spendCents: number;
      impressions: number;
      clicks: number;
      ctr: number;
      cpmCents: number;
      cpcCents: number;
    };
  };
  campaigns: Array<{
    name: string;
    status: string;
    spendCents: number;
    impressions: number;
    clicks: number;
    ctr: number;
  }>;
  coverage: { daysWithData: number; lastSyncedAt: string | null };
}

interface ReportRowProps {
  metaAdAccountId: string;
  accountName: string;
  businessName: string;
  currency: string;
}

export function ReportRow({
  metaAdAccountId,
  accountName,
  businessName,
  currency,
}: ReportRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [context, setContext] = useState<ReportContext | null>(null);
  const [copied, setCopied] = useState(false);
  const [showData, setShowData] = useState(false);

  const hasResult = Boolean(markdown || error);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    setExpanded(true); // auto-open while generating
    try {
      const res = await fetch("/api/ai/reports/weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: metaAdAccountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setMarkdown(data.markdown ?? "");
      setContext(data.context ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyMarkdown() {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  function downloadMarkdown() {
    if (!markdown || !context) return;
    const filename = `${accountName.replace(/[^\w-]+/g, "_")}_weekly_${context.periods.current.to}.md`;
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-md border border-border bg-background">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => hasResult && setExpanded((v) => !v)}
          disabled={!hasResult && !busy}
          aria-label={expanded ? "Collapse" : "Expand"}
          className={cn(
            "rounded p-0.5",
            hasResult || busy
              ? "text-muted hover:bg-surface-2 hover:text-foreground"
              : "cursor-not-allowed text-subtle",
          )}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {accountName}
          </div>
          <div className="truncate text-xs text-muted">
            {businessName} · {metaAdAccountId} · {currency}
          </div>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {busy ? "Generating…" : markdown ? "Regenerate" : "Generate"}
        </button>
      </div>

      {/* Expanded result */}
      {expanded && (
        <div className="space-y-3 border-t border-border px-5 py-4">
          {busy && !markdown && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Pulling data &amp; drafting narrative…
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          {markdown && (
            <>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={copyMarkdown}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-surface-2"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={downloadMarkdown}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-surface-2"
                >
                  <Download className="h-3 w-3" />
                  Download .md
                </button>
              </div>

              <article
                className={cn(
                  "rounded-md border border-border bg-surface px-5 py-4",
                  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:tracking-tight",
                  "[&_h2:first-child]:mt-0",
                  "[&_p]:my-2 [&_p]:text-sm [&_p]:leading-6 [&_p]:text-foreground",
                  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1",
                  "[&_li]:text-sm [&_li]:leading-6 [&_li]:text-foreground",
                  "[&_strong]:font-semibold [&_strong]:text-foreground",
                  "[&_em]:italic",
                  "[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_code]:font-mono",
                )}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {markdown}
                </ReactMarkdown>
              </article>

              {context && (
                <div className="rounded-md border border-border bg-surface">
                  <button
                    type="button"
                    onClick={() => setShowData((v) => !v)}
                    className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-muted hover:text-foreground"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" />
                      Underlying data ({context.coverage.daysWithData} day
                      {context.coverage.daysWithData === 1 ? "" : "s"},{" "}
                      {context.campaigns.length} campaigns)
                    </span>
                    <span>{showData ? "▴" : "▾"}</span>
                  </button>
                  {showData && (
                    <div className="space-y-2 border-t border-border px-4 py-3 text-xs">
                      <div className="text-muted">
                        Current {context.periods.current.from} →{" "}
                        {context.periods.current.to} · Previous{" "}
                        {context.periods.previous.from} →{" "}
                        {context.periods.previous.to}
                      </div>
                      <ul className="space-y-0.5 font-mono text-[11px] text-muted">
                        <li>
                          Spend:{" "}
                          {(context.totals.current.spendCents / 100).toFixed(2)}{" "}
                          {currency}
                        </li>
                        <li>
                          Impressions: {context.totals.current.impressions}
                        </li>
                        <li>Clicks: {context.totals.current.clicks}</li>
                        <li>
                          CTR: {(context.totals.current.ctr * 100).toFixed(2)}%
                        </li>
                      </ul>
                      {context.campaigns.length > 0 && (
                        <div>
                          <div className="mt-1 font-medium text-foreground">
                            Top campaigns
                          </div>
                          <ul className="mt-1 space-y-0.5 text-[11px] text-muted">
                            {context.campaigns.slice(0, 5).map((c, i) => (
                              <li key={i}>
                                <span className="font-mono">
                                  {(c.spendCents / 100).toFixed(2)} {currency}
                                </span>{" "}
                                — {c.name}{" "}
                                <span className="text-subtle">
                                  ({c.status})
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

            </>
          )}
        </div>
      )}
    </div>
  );
}
