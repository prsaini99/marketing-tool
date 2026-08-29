"use client";

import { useState } from "react";
import {
  Check,
  ExternalLink,
  ImagePlus,
  Loader2,
  Pencil,
  Save,
} from "lucide-react";

/**
 * VariantCard — one generated image tile inside the Ad Studio results grid,
 * plus its Tweak and Save-to-library flows. Extracted out of
 * studio-client.tsx (Task 6) because that file was already ~800 lines and a
 * prior review flagged it as a candidate for splitting once save-to-library
 * landed on top of Tweak.
 */

export type ImageQuality = "low" | "medium" | "high";

export interface SavedVariantRef {
  hash: string;
  // act_-prefixed Meta ad account id the image was uploaded into — needed
  // to build the "Use in a new ad" link's /dashboard/accounts/<id> path.
  accountId: string;
}

export interface AdImageVariant {
  b64: string;
  mimeType: string;
  // Set once Save succeeds. Its presence is what StudioClient's unsaved-
  // variants guard (src/lib/unsaved-guard.ts) checks — a variant that has
  // been uploaded to the account's Creative library isn't at risk of being
  // lost to a stray navigation the way an in-memory-only one is.
  saved?: SavedVariantRef;
}

export interface StudioAdAccount {
  id: string; // act_-prefixed
  name: string;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function base64ToFile(b64: string, mimeType: string, filenameBase: string): File {
  const byteChars = atob(b64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    bytes[i] = byteChars.charCodeAt(i);
  }
  const ext = EXT_BY_MIME[mimeType] ?? "png";
  return new File([bytes], `${filenameBase}.${ext}`, { type: mimeType });
}

export function VariantCard({
  index,
  variant,
  brief,
  quality,
  model,
  size,
  adAccounts,
  onReplace,
  onSaved,
}: {
  index: number;
  variant: AdImageVariant;
  brief: string;
  quality: ImageQuality;
  // The model the operator picked for THIS generation, threaded through so
  // Tweak edits on the same renderer instead of silently falling back to
  // DEFAULT_MODEL — see /api/ai/ad-image/tweak and generate-ad-image.ts's
  // TweakAdImageInput.model.
  model: string;
  // The size this variant was generated at. A tweak must request the same
  // one, or adjusting a 9:16 Stories ad returns it square.
  size: string | null;
  adAccounts: StudioAdAccount[];
  onReplace: (next: AdImageVariant) => void;
  onSaved: (saved: SavedVariantRef) => void;
}) {
  const [tweakOpen, setTweakOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [tweaking, setTweaking] = useState(false);
  const [tweakError, setTweakError] = useState<string | null>(null);

  // ── Save-to-library ──────────────────────────────────────────────────
  const [saveOpen, setSaveOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState(
    adAccounts.length === 1 ? adAccounts[0].id : "",
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
          model,
          size,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      if (!data.variant) throw new Error("No variant in response");
      // A tweak produces a genuinely different image, so any prior Save no
      // longer applies to what's on screen — onReplace's fresh object has
      // no `saved`, which is exactly right.
      onReplace(data.variant as AdImageVariant);
      setInstruction("");
      setTweakOpen(false);
    } catch (err) {
      setTweakError(err instanceof Error ? err.message : "Tweak failed");
    } finally {
      setTweaking(false);
    }
  }

  // No confirmation modal here — a deliberate departure from this repo's
  // convention that every create is confirmed (see confirm-modal.tsx and
  // its other callers). The operator is looking at the exact image they're
  // about to save, so clicking "Save to library" already IS the deliberate
  // act; the account-selector reveal is the extra step that stands in for
  // a modal. A modal on top of that would make keeping 2 of 4 variants a
  // four-click chore. This exemption is for Save only — nothing destructive
  // in this file skips confirmation.
  async function doSave() {
    if (!selectedAccountId || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const file = base64ToFile(
        variant.b64,
        variant.mimeType,
        `studio-variant-${index + 1}`,
      );
      const form = new FormData();
      form.set("accountId", selectedAccountId);
      form.set("image", file);
      const res = await fetch("/api/images", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      if (typeof data.hash !== "string") {
        throw new Error("Upload succeeded but no hash came back");
      }
      onSaved({ hash: data.hash, accountId: selectedAccountId });
      setSaveOpen(false);
    } catch (err) {
      // Deliberately does NOT clear/replace the variant — losing a
      // paid-for image to a transient upload error is the worst outcome
      // here, so it stays on screen with the account picker still open,
      // ready to retry.
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-background p-1.5">
      <div className="relative aspect-square overflow-hidden rounded-md bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dataUrl}
          alt={`Variant ${index + 1}`}
          className="h-full w-full object-cover"
        />
        {tweaking && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-[11px] text-white">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Tweaking…
          </div>
        )}
        <div className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
          V{index + 1}
        </div>
        {variant.saved && (
          <div className="absolute right-1 top-1 flex items-center gap-0.5 rounded bg-green-600/90 px-1.5 py-0.5 text-[9px] font-medium text-white">
            <Check className="h-2.5 w-2.5" />
            Saved
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            // Mutually exclusive with Save: both panels open at once
            // stacked two forms under one thumbnail and made the card
            // read as clutter.
            setTweakOpen((v) => !v);
            setSaveOpen(false);
          }}
          disabled={tweaking}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium hover:bg-surface-2 disabled:opacity-50"
        >
          <Pencil className="h-3 w-3" />
          Tweak
        </button>
        {!variant.saved && (
          <button
            type="button"
            onClick={() => {
              setSaveOpen((v) => !v);
              setSaveError(null);
              setTweakOpen(false);
            }}
            disabled={saving}
            title="Save this variant to the account's Creative library"
            className="inline-flex flex-1 items-center justify-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium hover:bg-surface-2 disabled:opacity-50"
          >
            <Save className="h-3 w-3" />
            Save
          </button>
        )}
      </div>

      {variant.saved && (
        <div className="space-y-1 rounded border border-green-200 bg-green-50 p-1.5 text-[11px] text-green-900">
          <p className="truncate" title={variant.saved.hash}>
            Saved · <span className="font-mono">{variant.saved.hash}</span>
          </p>
          <a
            href={`/dashboard/accounts/${variant.saved.accountId.replace(/^act_/, "")}/campaigns?image=${encodeURIComponent(variant.saved.hash)}`}
            className="inline-flex items-center gap-1 rounded border border-green-300 bg-background px-1.5 py-0.5 font-medium text-green-800 hover:bg-green-100"
          >
            <ExternalLink className="h-3 w-3" />
            Use in a new ad
          </a>
        </div>
      )}

      {saveOpen && !variant.saved && (
        <div className="space-y-1.5 rounded border border-accent/30 bg-accent/5 p-1.5">
          {adAccounts.length === 0 ? (
            <p className="text-[10px] text-danger">
              No ad account available to save into.
            </p>
          ) : (
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              disabled={saving}
              className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px] focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="" disabled>
                Choose an ad account…
              </option>
              {adAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          {saveError && (
            <div className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-danger">
              {saveError}
            </div>
          )}
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => {
                setSaveOpen(false);
                setSaveError(null);
              }}
              disabled={saving}
              className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doSave}
              disabled={saving || !selectedAccountId}
              className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              {saving ? "Saving…" : "Save to library"}
            </button>
          </div>
        </div>
      )}

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
            placeholder='e.g. "warmer lighting" / "remove the props"'
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
