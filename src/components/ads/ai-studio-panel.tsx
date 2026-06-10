"use client";

import { useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Package,
  Pencil,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * AiStudioPanel — single AI entry point at the top of the New Ad modal.
 *
 * Replaces the older standalone AiCopyPanel + AiImagePanel. One brief,
 * one Generate click, N matched variants per category (whichever side
 * the strategist toggled on). Per-category select + tweak. When the
 * strategist is happy, ONE "Apply to ad" button pushes the selected
 * copy into the form fields AND uploads the selected image to the
 * account's Meta library (returning its hash so the parent can select
 * it as the ad's media).
 *
 * Tweak semantics — preserved from the previous panels:
 *   - Tweaking the selected copy only re-runs the copy tweak endpoint.
 *   - Tweaking the selected image only re-runs the image tweak endpoint.
 *   - Neither side affects the other.
 *
 * Wire-level reality the user should know:
 *   - "One LLM call" is the user-facing button. Backend still fans out
 *     to two model families in parallel because gpt-4o-mini (text) and
 *     gpt-image-1 (image) physically cannot share a call. The panel
 *     surfaces this honestly with a small "powered by" caption.
 */

// ── Types ──────────────────────────────────────────────────────────────
export interface AdCopyVariant {
  headline: string;
  primaryText: string;
  description: string;
}

export interface AdImageVariant {
  b64: string;
  mimeType: string;
}

interface GroundedIn {
  voice: Array<{ sourceId: string; content: string }>;
  winners: Array<{
    sourceId: string;
    content: string;
    perf: {
      spendCents: number;
      revenueCents: number;
      conversionsCount: number;
      ctr: number;
      roas: number;
    };
  }>;
}

type ImageQuality = "low" | "medium" | "high";

// Rough per-image cost — mirrors the AiImagePanel labels so the strategist
// sees the same numbers they're used to.
const COST_BY_QUALITY: Record<ImageQuality, number> = {
  low: 1.5,
  medium: 4,
  high: 15,
};

interface AiStudioPanelProps {
  metaAdAccountId: string;
  disabled?: boolean;
  /**
   * Called when the strategist clicks "Apply to ad". Receives the final
   * copy (if a copy variant was selected) and the final image hash (if
   * an image variant was selected + uploaded). Parent populates the
   * form fields and selects the image hash in its library.
   */
  onApply: (payload: {
    copy: AdCopyVariant | null;
    image: { hash: string; url: string | null } | null;
  }) => void;
}

export function AiStudioPanel({
  metaAdAccountId,
  disabled,
  onApply,
}: AiStudioPanelProps) {
  // ── User controls ───────────────────────────────────────────────────
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(3);
  const [wantCopy, setWantCopy] = useState(true);
  const [wantImage, setWantImage] = useState(true);
  // Default to medium — baked-in promo text (headline/offer/CTA) comes out
  // mushy and misspelled at "low". Medium is the realistic floor for a
  // ready-to-ship creative; strategists can drop to low to save cost on
  // rough concepts or push to high for the final pick.
  const [imageQuality, setImageQuality] = useState<ImageQuality>("medium");
  // Optional product photo the model uses as fixed reference for the
  // image side. When set, image gen routes through images.edit() — the
  // brief becomes "scene direction around THIS product" instead of
  // "design a product from words". Copy is unaffected.
  const [productRefB64, setProductRefB64] = useState<string | null>(null);
  const [productRefDataUrl, setProductRefDataUrl] = useState<string | null>(
    null,
  );
  const [productRefName, setProductRefName] = useState<string | null>(null);
  const [productRefError, setProductRefError] = useState<string | null>(null);
  const productInputRef = useRef<HTMLInputElement>(null);

  // ── Generate state ──────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyVariants, setCopyVariants] = useState<AdCopyVariant[]>([]);
  const [imageVariants, setImageVariants] = useState<AdImageVariant[]>([]);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [voiceCount, setVoiceCount] = useState(0);
  const [winnersCount, setWinnersCount] = useState(0);
  // Which generation pipeline actually ran on the image side. The two
  // possible values are "from-scratch" (no product reference) and
  // "product-reference" (freestyle ad-creative using the upload as
  // reference). The product-reference path RECOGNISABLY uses the
  // strategist's product but isn't pixel-faithful — model has full
  // design freedom on pose, drape, framing, decorative elements.
  const [imagePattern, setImagePattern] = useState<
    "from-scratch" | "product-reference" | null
  >(null);

  // ── Selection state ─────────────────────────────────────────────────
  const [selectedCopyIdx, setSelectedCopyIdx] = useState<number | null>(null);
  const [selectedImageIdx, setSelectedImageIdx] = useState<number | null>(null);

  // ── Apply (finalize) state ──────────────────────────────────────────
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  // Read the picked file as base64. We split off the `data:image/...;base64,`
  // prefix when we send to the server (the OpenAI SDK wants raw bytes),
  // but keep the full dataUrl for the local thumbnail preview.
  function handleProductRefFile(file: File | null) {
    setProductRefError(null);
    if (!file) {
      setProductRefB64(null);
      setProductRefDataUrl(null);
      setProductRefName(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setProductRefError("Pick an image file.");
      return;
    }
    const MAX_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      setProductRefError(
        `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — limit is 10 MB.`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const commaIdx = dataUrl.indexOf(",");
      const raw = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
      setProductRefDataUrl(dataUrl);
      setProductRefB64(raw);
      setProductRefName(file.name);
    };
    reader.onerror = () => {
      setProductRefError("Couldn't read the file.");
    };
    reader.readAsDataURL(file);
  }

  function clearProductRef() {
    handleProductRefFile(null);
    if (productInputRef.current) productInputRef.current.value = "";
  }

  async function generate() {
    if (!brief.trim() || busy) return;
    if (!wantCopy && !wantImage) {
      setError("Turn on at least one of Copy or Image.");
      return;
    }
    setBusy(true);
    setError(null);
    setCopyError(null);
    setImageError(null);
    // A fresh generation invalidates any prior selection / apply state.
    setSelectedCopyIdx(null);
    setSelectedImageIdx(null);
    setApplied(false);
    setApplyError(null);
    setVoiceCount(0);
    setWinnersCount(0);

    try {
      const res = await fetch("/api/ai/ad-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: metaAdAccountId,
          brief: brief.trim(),
          count,
          generateCopy: wantCopy,
          generateImage: wantImage,
          imageQuality,
          // Only sent when image gen is on and the strategist actually
          // uploaded a product photo — server treats absence as "from
          // scratch" mode.
          productReferenceB64:
            wantImage && productRefB64 ? productRefB64 : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);

      // Copy side
      if (wantCopy) {
        if (data.copy?.variants) {
          setCopyVariants(data.copy.variants as AdCopyVariant[]);
          const grounded = data.copy.groundedIn as GroundedIn | undefined;
          setVoiceCount(grounded?.voice?.length ?? 0);
          setWinnersCount(grounded?.winners?.length ?? 0);
        } else {
          setCopyVariants([]);
          setCopyError(
            typeof data.copyError === "string"
              ? data.copyError
              : "Copy generation failed",
          );
        }
      } else {
        setCopyVariants([]);
      }

      // Image side
      if (wantImage) {
        if (data.image?.variants) {
          setImageVariants(data.image.variants as AdImageVariant[]);
          const p = data.image.pattern;
          setImagePattern(
            p === "from-scratch" || p === "product-reference" ? p : null,
          );
        } else {
          setImageVariants([]);
          setImagePattern(null);
          setImageError(
            typeof data.imageError === "string"
              ? data.imageError
              : "Image generation failed",
          );
        }
      } else {
        setImageVariants([]);
        setImagePattern(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  function replaceCopyVariant(idx: number, next: AdCopyVariant) {
    setCopyVariants((curr) => {
      const out = [...curr];
      out[idx] = next;
      return out;
    });
    // A tweak doesn't unset the selection — the strategist almost certainly
    // wants the tweaked variant to remain selected. Apply state is reset
    // because the live form values may need a re-push after Apply runs.
    setApplied(false);
  }

  function replaceImageVariant(idx: number, next: AdImageVariant) {
    setImageVariants((curr) => {
      const out = [...curr];
      out[idx] = next;
      return out;
    });
    setApplied(false);
  }

  // Helper — converts a base64 image variant to a Blob so we can POST it
  // to the existing /api/images upload route (which expects a multipart
  // FormData with an `image` file field).
  function b64ToBlob(b64: string, mime: string): Blob {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  /**
   * Final "Apply to ad" — pushes everything the strategist committed to
   * into the form. If an image variant was selected, it gets uploaded to
   * the account's Meta library here (single API call) and the resulting
   * hash + url are handed back via onApply so the parent can select it.
   *
   * The upload only runs at Apply time (not at variant-select time) so
   * the strategist can keep tweaking without burning library uploads on
   * every iteration.
   */
  async function applyToAd() {
    const hasCopy = selectedCopyIdx !== null && copyVariants[selectedCopyIdx];
    const hasImage =
      selectedImageIdx !== null && imageVariants[selectedImageIdx];
    if (!hasCopy && !hasImage) {
      setApplyError("Pick at least one variant before applying.");
      return;
    }

    setApplying(true);
    setApplyError(null);

    try {
      let imagePayload: { hash: string; url: string | null } | null = null;
      if (hasImage) {
        const v = imageVariants[selectedImageIdx!];
        const blob = b64ToBlob(v.b64, v.mimeType);
        const form = new FormData();
        form.set("accountId", metaAdAccountId);
        form.set(
          "image",
          new File([blob], `ai-${Date.now()}.png`, { type: v.mimeType }),
        );
        const res = await fetch("/api/images", {
          method: "POST",
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
        imagePayload = { hash: data.hash, url: data.url ?? null };
      }

      const copyPayload = hasCopy ? copyVariants[selectedCopyIdx!] : null;
      onApply({ copy: copyPayload, image: imagePayload });
      setApplied(true);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  }

  const hasResults = copyVariants.length > 0 || imageVariants.length > 0;
  const estCost =
    wantImage && !hasResults
      ? COST_BY_QUALITY[imageQuality] * count
      : null;

  return (
    <div className="space-y-3 rounded-md border border-accent/40 bg-accent/5 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-accent">
          <Sparkles className="h-3.5 w-3.5" />
          AI Studio — generate copy &amp; image together
        </div>
        <span className="text-[10px] text-subtle">
          One click · copy via gpt-4o-mini, image via gpt-image-1.5 (run in
          parallel)
        </span>
      </div>

      {/* ── Product reference (optional) ────────────────────────────── */}
      {/* When set, image gen flips to images.edit() and builds N scenes
          AROUND this exact product (saree, bottle, device). Copy is not
          affected. Only meaningful when "Generate image" is on, but we
          show it always — toggling image back on re-uses the upload. */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-foreground">
            Product reference{" "}
            <span className="font-normal text-subtle">(optional)</span>
          </label>
          {productRefB64 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
              <Package className="h-2.5 w-2.5" />
              Reference mode — designs a promo creative around your product
            </span>
          )}
        </div>

        {productRefB64 && productRefDataUrl ? (
          <div className="flex items-center gap-2 rounded-md border border-accent/40 bg-background p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={productRefDataUrl}
              alt={productRefName ?? "Product reference"}
              className="h-16 w-16 shrink-0 rounded border border-border object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium text-foreground">
                {productRefName ?? "Product reference"}
              </div>
              <div className="text-[10px] text-subtle">
                gpt-image-1.5 reads this photo at high fidelity and designs
                a complete promo creative around the product — keeping the
                SAME saree (pattern, border, pallu, colour) while adding
                your offer headline, discount figure and a SHOP NOW button.
                The model restages the scene, pose and typography; the
                garment itself stays faithful to your upload.
              </div>
            </div>
            <button
              type="button"
              onClick={clearProductRef}
              disabled={busy}
              aria-label="Remove product reference"
              className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <>
            <input
              ref={productInputRef}
              type="file"
              accept="image/*"
              onChange={(e) =>
                handleProductRefFile(e.target.files?.[0] ?? null)
              }
              disabled={disabled || busy}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => productInputRef.current?.click()}
              disabled={disabled || busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-surface px-3 py-2 text-[11px] text-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Package className="h-3.5 w-3.5 text-subtle" />
              Upload product photo — model designs a promo creative around it
            </button>
            <p className="text-[10px] text-subtle">
              Optional. Without a product photo the creative is invented from
              scratch from your brief. With one, your product stays the hero and
              the model designs the festive scene + offer typography around it.
            </p>
          </>
        )}

        {productRefError && (
          <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-danger">
            {productRefError}
          </div>
        )}
      </div>

      {/* ── Brief ───────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-foreground">
          Your ad brief{" "}
          <span className="font-normal text-subtle">
            — drives both copy &amp; creative
          </span>
        </label>
        <textarea
          rows={2}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={
            productRefB64
              ? "e.g. Diwali offer, FLAT 50% OFF, SHOP NOW — festive scene, model wearing it, warm golden-hour light, diyas & marigolds"
              : "e.g. Diwali saree sale, FLAT 50% OFF, SHOP NOW — urgency hook, target 25–45 women, festive warm lighting"
          }
          disabled={disabled || busy}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <p className="text-[10px] text-subtle">
          Name the <span className="font-medium text-foreground">offer, discount and CTA</span>{" "}
          (e.g. &ldquo;Diwali, 50% off, Shop Now&rdquo;) — they get{" "}
          <span className="font-medium text-foreground">designed into the image</span>{" "}
          as a ready-to-publish promo creative. Copy is still grounded in this
          account&rsquo;s past ads + cross-account winners.
        </p>
      </div>

      {/* ── Toggles + dropdowns ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-4 text-[11px]">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={wantCopy}
              onChange={(e) => setWantCopy(e.target.checked)}
              disabled={busy}
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
            <span className="font-medium text-foreground">Generate copy</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={wantImage}
              onChange={(e) => setWantImage(e.target.checked)}
              disabled={busy}
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
            <span className="font-medium text-foreground">Generate image</span>
          </label>

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

          {wantImage && (
            <label className="flex items-center gap-1">
              <span className="text-muted">Image quality:</span>
              <select
                value={imageQuality}
                onChange={(e) =>
                  setImageQuality(e.target.value as ImageQuality)
                }
                disabled={busy}
                className="rounded border border-border bg-background px-1.5 py-0.5"
              >
                <option value="low">Low (~₹1.5)</option>
                <option value="medium">Medium (~₹4)</option>
                <option value="high">High (~₹15)</option>
              </select>
            </label>
          )}

          {wantImage && imageQuality === "low" && (
            <span className="text-[10px] text-amber-600">
              ⚠ baked-in offer text may look mushy at Low — Medium+ recommended
            </span>
          )}

          {estCost !== null && (
            <span className="text-subtle">
              est. ₹{estCost.toFixed(1)} this click
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={
            disabled || busy || !brief.trim() || (!wantCopy && !wantImage)
          }
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          {busy ? "Generating…" : hasResults ? "Regenerate" : "Generate"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-danger">
          {error}
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────────────── */}
      {hasResults && (
        <div className="space-y-3">
          {(voiceCount > 0 || winnersCount > 0) && wantCopy && (
            <div
              className="text-[10px] text-subtle"
              title="Voice: past ads from this account. Winners: high-ROAS / high-engagement ads from other accounts in your portfolio, used as hook/angle inspiration."
            >
              Copy grounded in{" "}
              <span className="font-medium text-foreground">{voiceCount}</span>{" "}
              voice ref{voiceCount === 1 ? "" : "s"} +{" "}
              <span className="font-medium text-foreground">
                {winnersCount}
              </span>{" "}
              cross-account winner{winnersCount === 1 ? "" : "s"}
            </div>
          )}

          {/* Image first (the heavier visual commitment — strategists
              usually pick the look, then write copy that fits the mood),
              copy second. Both render at full panel width so neither
              feels squeezed into a half-column. */}
          <div className="space-y-4">
            {/* ── Image section ─────────────────────────────────────── */}
            {wantImage && (
              <section className="space-y-2">
                <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-subtle">
                  <span>
                    Step 1 · Image variants
                    {imagePattern === "product-reference" && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] normal-case font-medium text-accent">
                        <Package className="h-2 w-2" />
                        designed around your product
                      </span>
                    )}
                  </span>
                  {selectedImageIdx !== null && (
                    <span className="normal-case font-normal text-accent">
                      ✓ V{selectedImageIdx + 1} selected
                    </span>
                  )}
                </div>
                {imageError ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-danger">
                    {imageError}
                  </div>
                ) : imageVariants.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-surface px-3 py-4 text-center text-[11px] text-subtle">
                    No image variants.
                  </div>
                ) : (
                  <div
                    className={cn(
                      "grid gap-2",
                      // Match column count to variant count so each card
                      // is a comfortable size: 1 → centred singleton,
                      // 2 → two columns, 3 → three, 4 → four.
                      imageVariants.length === 1 && "grid-cols-1 max-w-xs",
                      imageVariants.length === 2 && "grid-cols-2",
                      imageVariants.length === 3 && "grid-cols-3",
                      imageVariants.length >= 4 && "grid-cols-2 sm:grid-cols-4",
                    )}
                  >
                    {imageVariants.map((v, i) => (
                      <ImageVariantCard
                        key={i}
                        index={i}
                        variant={v}
                        selected={selectedImageIdx === i}
                        disabled={Boolean(disabled) || applying}
                        brief={brief}
                        quality={imageQuality}
                        onSelect={() => {
                          setSelectedImageIdx(i);
                          setApplied(false);
                        }}
                        onReplace={(next) => replaceImageVariant(i, next)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ── Copy section ──────────────────────────────────────── */}
            {wantCopy && (
              <section className="space-y-2">
                <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-subtle">
                  <span>
                    {wantImage ? "Step 2 · " : ""}Copy variants
                  </span>
                  {selectedCopyIdx !== null && (
                    <span className="normal-case font-normal text-accent">
                      ✓ V{selectedCopyIdx + 1} selected
                    </span>
                  )}
                </div>
                {copyError ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-danger">
                    {copyError}
                  </div>
                ) : copyVariants.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-surface px-3 py-4 text-center text-[11px] text-subtle">
                    No copy variants.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {copyVariants.map((v, i) => (
                      <CopyVariantCard
                        key={i}
                        index={i}
                        variant={v}
                        selected={selectedCopyIdx === i}
                        disabled={Boolean(disabled) || applying}
                        metaAdAccountId={metaAdAccountId}
                        brief={brief}
                        onSelect={() => {
                          setSelectedCopyIdx(i);
                          setApplied(false);
                        }}
                        onReplace={(next) => replaceCopyVariant(i, next)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>

          {/* ── Apply to ad ─────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent/40 bg-background px-3 py-2">
            <div className="text-[11px]">
              <div className="font-medium text-foreground">
                {applied ? (
                  <span className="inline-flex items-center gap-1 text-accent">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Applied to the ad form — you can keep tweaking and re-apply
                  </span>
                ) : (
                  "Finalised? Apply to ad fills the form in one click."
                )}
              </div>
              <div className="mt-0.5 text-subtle">
                {summariseApply({
                  copySelected: selectedCopyIdx !== null,
                  imageSelected: selectedImageIdx !== null,
                  wantCopy,
                  wantImage,
                })}
              </div>
            </div>
            <button
              type="button"
              onClick={applyToAd}
              disabled={
                disabled ||
                applying ||
                (selectedCopyIdx === null && selectedImageIdx === null)
              }
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3 w-3" />
              )}
              {applying
                ? "Applying…"
                : applied
                  ? "Re-apply"
                  : "Apply to ad"}
            </button>
          </div>

          {applyError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-danger">
              {applyError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Small helper — humanises the "you've picked X" caption under Apply ────

function summariseApply(args: {
  copySelected: boolean;
  imageSelected: boolean;
  wantCopy: boolean;
  wantImage: boolean;
}): string {
  const parts: string[] = [];
  if (args.wantCopy) {
    parts.push(args.copySelected ? "copy ✓" : "copy: pick one");
  }
  if (args.wantImage) {
    parts.push(args.imageSelected ? "image ✓" : "image: pick one");
  }
  return parts.join(" · ");
}

// ── Copy variant card ────────────────────────────────────────────────────
// Tweak is owned by the card — instruction only modifies THIS variant's
// copy fields. Per the user's explicit ask: tweaking copy must never
// touch the image side (separate endpoint, separate state).

interface CopyVariantCardProps {
  index: number;
  variant: AdCopyVariant;
  selected: boolean;
  disabled: boolean;
  metaAdAccountId: string;
  brief: string;
  onSelect: () => void;
  onReplace: (next: AdCopyVariant) => void;
}

function CopyVariantCard({
  index,
  variant,
  selected,
  disabled,
  metaAdAccountId,
  brief,
  onSelect,
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
        selected
          ? "border-accent ring-1 ring-accent"
          : "border-border hover:border-accent/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-subtle">
          V{index + 1}
        </div>
        <div className="flex items-center gap-1">
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
            onClick={onSelect}
            disabled={disabled}
            className={cn(
              "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium disabled:opacity-50",
              selected
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-background hover:bg-surface-2",
            )}
          >
            {selected ? (
              <>
                <Check className="h-3 w-3" />
                Selected
              </>
            ) : (
              "Select"
            )}
          </button>
        </div>
      </div>
      <div className="mt-1 font-medium text-foreground">{variant.headline}</div>
      <div className="mt-1 whitespace-pre-line text-muted">
        {variant.primaryText}
      </div>
      {variant.description && (
        <div className="mt-1 text-[11px] text-subtle">
          {variant.description}
        </div>
      )}

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
          <p className="text-[10px] text-subtle">
            Tweaks this copy variant only — image variants stay untouched.
          </p>
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

// ── Image variant card ───────────────────────────────────────────────────
// Tweak hits images.edit() server-side — only this image variant changes,
// no copy variant is touched.

interface ImageVariantCardProps {
  index: number;
  variant: AdImageVariant;
  selected: boolean;
  disabled: boolean;
  brief: string;
  quality: ImageQuality;
  onSelect: () => void;
  onReplace: (next: AdImageVariant) => void;
}

function ImageVariantCard({
  index,
  variant,
  selected,
  disabled,
  brief,
  quality,
  onSelect,
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
          originalB64: variant.b64,
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
    <div
      className={cn(
        "space-y-1.5 rounded-md border bg-background p-1.5 transition-colors",
        selected
          ? "border-accent ring-1 ring-accent"
          : "border-border hover:border-accent/40",
      )}
    >
      <div className="relative aspect-square overflow-hidden rounded-md bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dataUrl}
          alt={`AI variant V${index + 1}`}
          className="h-full w-full object-cover"
        />
        {tweaking && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-[11px]">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Tweaking…
          </div>
        )}
        <div className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
          V{index + 1}
        </div>
        {selected && (
          <div className="absolute right-1 top-1 rounded-full bg-accent p-0.5 text-accent-foreground">
            <Check className="h-3 w-3" />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setTweakOpen((v) => !v)}
          disabled={disabled || tweaking}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium hover:bg-surface-2 disabled:opacity-50"
        >
          <Pencil className="h-3 w-3" />
          Tweak
        </button>
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled || tweaking}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium disabled:opacity-50",
            selected
              ? "border-accent bg-accent text-accent-foreground"
              : "border-border bg-background hover:bg-surface-2",
          )}
        >
          {selected ? (
            <>
              <Check className="h-3 w-3" />
              Selected
            </>
          ) : (
            "Select"
          )}
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
            placeholder='e.g. "warmer lighting" / "remove the props" / "more festive"'
            disabled={tweaking}
            className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px] placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <p className="text-[10px] text-subtle">
            Tweaks this image variant only — copy variants stay untouched.
          </p>
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
