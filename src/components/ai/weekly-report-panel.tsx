"use client";

import { useState } from "react";
import {
  Check,
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
 * Auto-drafted weekly performance report — the user-facing piece of
 * /dashboard/accounts/[id]/reports.
 *
 * Click Generate → POST /api/ai/reports/weekly → LLM narrates the last 7
 * days vs the prior 7 days from the synced InsightsSnapshot data. Output
 * is markdown rendered with react-markdown + GFM, plus copy / download
 * buttons so the report can ride straight into an email or doc.
 *
 * The underlying context (totals, top campaigns) can be expanded for
 * transparency — "here's what we read, here's what we wrote about it."
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

interface WeeklyReportPanelProps {
  metaAdAccountId: string;
  accountName: string;
  currency: string;
}

export function WeeklyReportPanel({
  metaAdAccountId,
  accountName,
  currency,
}: WeeklyReportPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [context, setContext] = useState<ReportContext | null>(null);
  const [copied, setCopied] = useState(false);
  const [showData, setShowData] = useState(false);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setCopied(false);
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
      // older browsers / iframe context — surface an error inline
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
    <div className="space-y-4">
      {/* Generate row */}
      <div className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3">
        <div>
          <div className="text-sm font-medium text-foreground">
            Weekly performance report
          </div>
          <p className="text-xs text-muted">
            Last 7 days vs the prior week — narrated, client-ready, copy-able.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {markdown && (
            <>
              <button
                type="button"
                onClick={copyMarkdown}
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
                onClick={downloadMarkdown}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2"
              >
                <Download className="h-3.5 w-3.5" />
                Download .md
              </button>
            </>
          )}
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {busy ? "Generating…" : markdown ? "Regenerate" : "Generate report"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {/* Rendered narrative */}
      {markdown && (
        <article
          className={cn(
            "rounded-md border border-border bg-background px-6 py-5",
            // Self-contained typography — no Tailwind typography plugin
            // assumption. Tight, document-y feel.
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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
      )}

      {/* Underlying data — transparency: "here's what we read" */}
      {context && (
        <div className="rounded-md border border-border bg-surface">
          <button
            type="button"
            onClick={() => setShowData((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-muted hover:text-foreground"
          >
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Underlying data ({context.coverage.daysWithData} day
              {context.coverage.daysWithData === 1 ? "" : "s"} of data,{" "}
              {context.campaigns.length} campaigns)
            </span>
            <span>{showData ? "▴" : "▾"}</span>
          </button>
          {showData && (
            <div className="space-y-3 border-t border-border px-4 py-3 text-xs">
              <div>
                <div className="font-medium text-foreground">Window</div>
                <div className="text-muted">
                  Current {context.periods.current.from} →{" "}
                  {context.periods.current.to} · Previous{" "}
                  {context.periods.previous.from} →{" "}
                  {context.periods.previous.to}
                </div>
              </div>
              <div>
                <div className="font-medium text-foreground">
                  Totals (current window)
                </div>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted">
                  <li>
                    Spend: {(context.totals.current.spendCents / 100).toFixed(2)}{" "}
                    {currency}
                  </li>
                  <li>Impressions: {context.totals.current.impressions}</li>
                  <li>Clicks: {context.totals.current.clicks}</li>
                  <li>
                    CTR: {(context.totals.current.ctr * 100).toFixed(2)}%
                  </li>
                  <li>
                    CPM: {(context.totals.current.cpmCents / 100).toFixed(2)}{" "}
                    {currency}
                  </li>
                  <li>
                    CPC: {(context.totals.current.cpcCents / 100).toFixed(2)}{" "}
                    {currency}
                  </li>
                </ul>
              </div>
              {context.campaigns.length > 0 && (
                <div>
                  <div className="font-medium text-foreground">
                    Top campaigns by spend
                  </div>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-muted">
                    {context.campaigns.map((c, i) => (
                      <li key={i}>
                        <span className="font-mono">
                          {(c.spendCents / 100).toFixed(2)} {currency}
                        </span>{" "}
                        — {c.name} <span className="text-subtle">({c.status})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Empty state — first time, no report yet */}
      {!markdown && !busy && !error && (
        <div className="rounded-md border border-dashed border-border bg-surface px-6 py-10 text-center">
          <FileText className="mx-auto h-8 w-8 text-subtle" />
          <p className="mt-2 text-sm font-medium text-foreground">
            No report yet
          </p>
          <p className="mt-1 text-xs text-muted">
            Click <span className="font-medium">Generate report</span> above to
            draft a weekly performance summary for{" "}
            <span className="text-foreground">{accountName}</span>.
          </p>
        </div>
      )}
    </div>
  );
}
