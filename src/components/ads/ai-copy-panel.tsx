"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Brand-voice ad-copy generation panel for the Create-Ad modal.
 *
 * Sits above the Copy section. Collapsed by default — users who want to
 * write manually never see anything more than the "Generate with AI" button.
 *
 * Flow:
 *   1. User types a brief ("Diwali sale, urgency, 25–45 women").
 *   2. POST /api/ai/ad-copy/generate → RAG searches this account's past
 *      copy, feeds top hits to the LLM as brand voice, returns N variants.
 *   3. User clicks "Use this" on a variant → parent populates the form
 *      (headline / primary text / description).
 *
 * Designed to be additive — generation can fail / be skipped without
 * affecting the rest of the modal.
 */

export interface AdCopyVariant {
  headline: string;
  primaryText: string;
  description: string;
}

interface AiCopyPanelProps {
  metaAdAccountId: string;
  disabled?: boolean;
  onApply: (variant: AdCopyVariant) => void;
}

export function AiCopyPanel({
  metaAdAccountId,
  disabled,
  onApply,
}: AiCopyPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variants, setVariants] = useState<AdCopyVariant[]>([]);
  const [appliedIdx, setAppliedIdx] = useState<number | null>(null);

  async function generate() {
    if (!brief.trim() || busy) return;
    setBusy(true);
    setError(null);
    setAppliedIdx(null);
    try {
      const res = await fetch("/api/ai/ad-copy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: metaAdAccountId,
          brief: brief.trim(),
          count,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setVariants(Array.isArray(data.variants) ? data.variants : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-accent/40 bg-accent/5 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Generate copy with AI
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-accent/40 bg-accent/5 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-accent">
          <Sparkles className="h-3.5 w-3.5" />
          AI copy generation
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          disabled={busy}
          aria-label="Close AI panel"
          className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-medium text-foreground">
          What&apos;s this ad about?
        </label>
        <textarea
          rows={2}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. Diwali saree sale 50% off, urgency hook, target 25–45 women"
          disabled={disabled || busy}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <p className="text-[10px] text-subtle">
          Grounded in this account&apos;s past ad copy (brand voice). The more
          context you give, the better the variants.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px]">
          <label className="text-muted">Variants:</label>
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            disabled={busy}
            className="rounded border border-border bg-background px-1.5 py-0.5"
          >
            <option value={3}>3</option>
            <option value={5}>5</option>
            <option value={7}>7</option>
          </select>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={disabled || busy || !brief.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          {busy
            ? "Generating…"
            : variants.length > 0
              ? "Regenerate"
              : "Generate"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-danger">
          {error}
        </div>
      )}

      {variants.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-subtle">
            {variants.length} variants — click &ldquo;Use this&rdquo; to fill
            the form
          </div>
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-0.5">
            {variants.map((v, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-md border bg-background p-2.5 text-xs transition-colors",
                  appliedIdx === i
                    ? "border-accent ring-1 ring-accent"
                    : "border-border hover:border-accent/40",
                )}
              >
                <div className="font-medium text-foreground">{v.headline}</div>
                <div className="mt-1 whitespace-pre-line text-muted">
                  {v.primaryText}
                </div>
                {v.description && (
                  <div className="mt-1 text-[11px] text-subtle">
                    {v.description}
                  </div>
                )}
                <div className="mt-1.5 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      onApply(v);
                      setAppliedIdx(i);
                    }}
                    disabled={disabled}
                    className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium hover:bg-surface-2 disabled:opacity-50"
                  >
                    {appliedIdx === i ? (
                      <>
                        <Check className="h-3 w-3" />
                        Applied
                      </>
                    ) : (
                      "Use this"
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
