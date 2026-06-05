"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, Sparkles, X } from "lucide-react";
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
  // Transparency counters — surfaced as a chip so the strategist knows
  // what the model was steered by (brand voice from this account +
  // cross-account winners from the agency portfolio).
  const [voiceCount, setVoiceCount] = useState(0);
  const [winnersCount, setWinnersCount] = useState(0);

  async function generate() {
    if (!brief.trim() || busy) return;
    setBusy(true);
    setError(null);
    setAppliedIdx(null);
    setVoiceCount(0);
    setWinnersCount(0);
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
      // groundedIn now ships split: voice (this account) + winners
      // (cross-account high performers). Read defensively in case an
      // older server version is responding.
      const groundedIn = data.groundedIn ?? {};
      setVoiceCount(
        Array.isArray(groundedIn.voice) ? groundedIn.voice.length : 0,
      );
      setWinnersCount(
        Array.isArray(groundedIn.winners) ? groundedIn.winners.length : 0,
      );
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-subtle">
              {variants.length} variants — pick one, or tweak it before
              applying
            </div>
            {(voiceCount > 0 || winnersCount > 0) && (
              <div
                className="text-[10px] text-subtle"
                title="Voice: past ads from this account. Winners: high-ROAS / high-engagement ads from other accounts in your portfolio, used as hook/angle inspiration."
              >
                grounded in{" "}
                <span className="font-medium text-foreground">
                  {voiceCount}
                </span>{" "}
                voice ref{voiceCount === 1 ? "" : "s"} +{" "}
                <span className="font-medium text-foreground">
                  {winnersCount}
                </span>{" "}
                cross-account winner{winnersCount === 1 ? "" : "s"}
              </div>
            )}
          </div>
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-0.5">
            {variants.map((v, i) => (
              <CopyVariantCard
                key={i}
                variant={v}
                applied={appliedIdx === i}
                disabled={Boolean(disabled)}
                metaAdAccountId={metaAdAccountId}
                brief={brief}
                onApply={() => {
                  onApply(v);
                  setAppliedIdx(i);
                }}
                onReplace={(updated) => {
                  setVariants((curr) => {
                    const next = [...curr];
                    next[i] = updated;
                    return next;
                  });
                  // If the tweaked variant was the applied one, push the
                  // change into the form too so the live preview matches.
                  if (appliedIdx === i) onApply(updated);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Per-variant card with inline tweak ─────────────────────────────────────
// Each variant owns its own tweak state so the strategist can refine one
// without disturbing the others. On a successful tweak, the parent's
// `variants` array gets the new copy spliced in at the same index.

interface CopyVariantCardProps {
  variant: AdCopyVariant;
  applied: boolean;
  disabled: boolean;
  metaAdAccountId: string;
  brief: string;
  onApply: () => void;
  onReplace: (next: AdCopyVariant) => void;
}

function CopyVariantCard({
  variant,
  applied,
  disabled,
  metaAdAccountId,
  brief,
  onApply,
  onReplace,
}: CopyVariantCardProps) {
  const [tweakOpen, setTweakOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [tweaking, setTweaking] = useState(false);
  const [tweakError, setTweakError] = useState<string | null>(null);

  async function applyTweak() {
    const t = instruction.trim();
    if (!t || tweaking) return;
    setTweaking(true);
    setTweakError(null);
    try {
      const res = await fetch("/api/ai/ad-copy/tweak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: metaAdAccountId,
          brief,
          original: variant,
          instruction: t,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      if (!data.variant) throw new Error("No variant in response");
      onReplace(data.variant as AdCopyVariant);
      setInstruction("");
      setTweakOpen(false);
    } catch (err) {
      setTweakError(err instanceof Error ? err.message : "Tweak failed");
    } finally {
      setTweaking(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-md border bg-background p-2.5 text-xs transition-colors",
        applied
          ? "border-accent ring-1 ring-accent"
          : "border-border hover:border-accent/40",
      )}
    >
      <div className="font-medium text-foreground">{variant.headline}</div>
      <div className="mt-1 whitespace-pre-line text-muted">
        {variant.primaryText}
      </div>
      {variant.description && (
        <div className="mt-1 text-[11px] text-subtle">
          {variant.description}
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => setTweakOpen((v) => !v)}
          disabled={disabled || tweaking}
          className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium hover:bg-surface-2 disabled:opacity-50"
        >
          <Pencil className="h-3 w-3" />
          Tweak
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium hover:bg-surface-2 disabled:opacity-50"
        >
          {applied ? (
            <>
              <Check className="h-3 w-3" />
              Applied
            </>
          ) : (
            "Use"
          )}
        </button>
      </div>

      {tweakOpen && (
        <div className="mt-2 space-y-1.5 rounded-md border border-accent/30 bg-accent/5 p-2">
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyTweak();
              }
            }}
            placeholder='e.g. "make it shorter" / "more urgent" / "mention 50% off in headline"'
            disabled={tweaking}
            className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {tweakError && (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-danger">
              {tweakError}
            </div>
          )}
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => {
                setTweakOpen(false);
                setInstruction("");
                setTweakError(null);
              }}
              disabled={tweaking}
              className="rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyTweak}
              disabled={tweaking || !instruction.trim()}
              className="inline-flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {tweaking ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Pencil className="h-3 w-3" />
              )}
              {tweaking ? "Tweaking…" : "Apply tweak"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
