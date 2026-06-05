"use client";

import { useState } from "react";
import {
  Check,
  ImagePlus,
  Loader2,
  Pencil,
  Sparkles,
} from "lucide-react";

/**
 * AI ad-image generation + per-variant tweak — sister panel to
 * AiCopyPanel, lives inside the New Ad modal under the Image media tab.
 *
 * Flow:
 *   1. Type a brief → Generate → POST /api/ai/ad-image/generate
 *   2. 3 image variants render as base64 thumbnails.
 *   3. Tweak (per variant): "more festive / warmer lighting / drop the
 *      props" → POST /api/ai/ad-image/tweak → that single variant is
 *      replaced in place.
 *   4. Use this → POST /api/images (the existing library-upload route)
 *      with the bytes → returns hash + url → parent switches the form's
 *      image-source mode to "library" and selects the new hash.
 *
 * Why base64 (not URL): OpenAI's hosted URLs expire in 1 hour. Holding
 * variants in client state keeps them ready for tweak / re-use without
 * a race against expiry.
 */

export interface AdImageVariant {
  b64: string;
  mimeType: string;
}

interface AiImagePanelProps {
  metaAdAccountId: string;
  disabled?: boolean;
  /**
   * Called once a chosen variant has been uploaded to Meta. Parent should
   * switch the form's image source to "library" and select the new hash.
   */
  onPicked: (picked: { hash: string; url: string | null }) => void;
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

type ImageQuality = "low" | "medium" | "high";

// Rough per-image rupee cost by quality tier — used to render the live
// estimate next to the Generate button so cost isn't a surprise.
const COST_BY_QUALITY: Record<ImageQuality, number> = {
  low: 1.5,
  medium: 4,
  high: 15,
};

export function AiImagePanel({
  metaAdAccountId,
  disabled,
  onPicked,
}: AiImagePanelProps) {
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(2);
  const [quality, setQuality] = useState<ImageQuality>("low");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variants, setVariants] = useState<AdImageVariant[]>([]);
  // Tracks which index is currently uploading to Meta (so we can show a
  // spinner on its "Use this" button without freezing the whole panel).
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [pickedHash, setPickedHash] = useState<string | null>(null);

  async function generate() {
    if (!brief.trim() || busy) return;
    setBusy(true);
    setError(null);
    setPickedHash(null);
    try {
      const res = await fetch("/api/ai/ad-image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: brief.trim(), count, quality }),
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

  async function pickVariant(idx: number) {
    const v = variants[idx];
    if (!v || uploadingIdx !== null) return;
    setUploadingIdx(idx);
    setError(null);
    try {
      const blob = b64ToBlob(v.b64, v.mimeType);
      const form = new FormData();
      form.set("accountId", metaAdAccountId);
      form.set(
        "image",
        new File([blob], `ai-${Date.now()}.png`, { type: v.mimeType }),
      );
      const res = await fetch("/api/images", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onPicked({ hash: data.hash, url: data.url ?? null });
      setPickedHash(data.hash ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingIdx(null);
    }
  }

  function replaceVariant(idx: number, next: AdImageVariant) {
    setVariants((curr) => {
      const out = [...curr];
      out[idx] = next;
      return out;
    });
    // If the tweaked variant was the picked one, the upload is now stale.
    // Force a re-pick (clear the picked hash) so they can hit "Use this" again.
    setPickedHash(null);
  }

  return (
    <div className="space-y-2 rounded-md border border-accent/40 bg-accent/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-accent">
        <Sparkles className="h-3.5 w-3.5" />
        AI image generation
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-medium text-foreground">
          What should the image show?
        </label>
        <textarea
          rows={2}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. Diwali saree on a model with festive bokeh background, warm golden lighting, premium feel, vertical poster style"
          disabled={disabled || busy}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <p className="text-[10px] text-subtle">
          1024 × 1024 square output. ~10–40 s per generation. Quality
          drives cost — low is fine for brainstorming, switch to medium /
          high once you&apos;ve picked an angle worth committing to.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <label className="flex items-center gap-1">
            <span className="text-muted">Variants:</span>
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              disabled={busy}
              className="rounded border border-border bg-background px-1.5 py-0.5"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted">Quality:</span>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as ImageQuality)}
              disabled={busy}
              className="rounded border border-border bg-background px-1.5 py-0.5"
            >
              <option value="low">Low (~₹1.5)</option>
              <option value="medium">Medium (~₹4)</option>
              <option value="high">High (~₹15)</option>
            </select>
          </label>
          <span className="text-subtle">
            est. ₹{(COST_BY_QUALITY[quality] * count).toFixed(1)} this click
          </span>
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
            {variants.length} variant{variants.length === 1 ? "" : "s"} — pick
            one, or tweak it before applying
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {variants.map((v, i) => (
              <ImageVariantCard
                key={i}
                variant={v}
                brief={brief}
                quality={quality}
                disabled={Boolean(disabled)}
                isUploading={uploadingIdx === i}
                wasPicked={pickedHash !== null && uploadingIdx === null}
                onPick={() => pickVariant(i)}
                onReplace={(next) => replaceVariant(i, next)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Per-variant card with tweak ────────────────────────────────────────────

interface ImageVariantCardProps {
  variant: AdImageVariant;
  brief: string;
  quality: ImageQuality;
  disabled: boolean;
  isUploading: boolean;
  wasPicked: boolean;
  onPick: () => void;
  onReplace: (next: AdImageVariant) => void;
}

function ImageVariantCard({
  variant,
  brief,
  quality,
  disabled,
  isUploading,
  onPick,
  onReplace,
}: ImageVariantCardProps) {
  const [tweakOpen, setTweakOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [tweaking, setTweaking] = useState(false);
  const [tweakError, setTweakError] = useState<string | null>(null);

  const dataUrl = `data:${variant.mimeType};base64,${variant.b64}`;

  async function applyTweak() {
    const t = instruction.trim();
    if (!t || tweaking) return;
    setTweaking(true);
    setTweakError(null);
    try {
      const res = await fetch("/api/ai/ad-image/tweak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief,
          instruction: t,
          // Send the actual image bytes so the server uses images.edit()
          // (preserves composition) instead of a fresh text-to-image regen.
          originalB64: variant.b64,
          // Tweak at the same quality the strategist picked — keeps the
          // cost expectation consistent across generate + tweak.
          quality,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      if (!data.variant) throw new Error("No variant in response");
      onReplace(data.variant as AdImageVariant);
      setInstruction("");
      setTweakOpen(false);
    } catch (err) {
      setTweakError(err instanceof Error ? err.message : "Tweak failed");
    } finally {
      setTweaking(false);
    }
  }

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-background p-1.5">
      <div className="relative aspect-square overflow-hidden rounded-md bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dataUrl}
          alt="AI variant"
          className="h-full w-full object-cover"
        />
        {(tweaking || isUploading) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-[11px]">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            {tweaking ? "Tweaking…" : "Uploading…"}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setTweakOpen((v) => !v)}
          disabled={disabled || tweaking || isUploading}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium hover:bg-surface-2 disabled:opacity-50"
        >
          <Pencil className="h-3 w-3" />
          Tweak
        </button>
        <button
          type="button"
          onClick={onPick}
          disabled={disabled || tweaking || isUploading}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isUploading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          Use
        </button>
      </div>

      {tweakOpen && (
        <div className="space-y-1.5 rounded border border-accent/30 bg-accent/5 p-1.5">
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
            placeholder='e.g. "more festive" / "warmer lighting" / "remove the props"'
            disabled={tweaking}
            className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px] placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {tweakError && (
            <div className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-danger">
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
              className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyTweak}
              disabled={tweaking || !instruction.trim()}
              className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {tweaking ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ImagePlus className="h-3 w-3" />
              )}
              {tweaking ? "Tweaking…" : "Apply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
