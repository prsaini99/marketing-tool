"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Loader2,
  Palette,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmModal } from "@/components/ui/confirm-modal";

/**
 * BrandKitPanel — collapsible editor for a brand kit: colour palette,
 * brand name and tagline, theme notes, a do-not list, one logo, and a
 * grid of style references. Feeds prompt assembly for the Ad Studio image
 * generator (buildStudioPrompt). Mounted on /dashboard/studio.
 *
 * `businessId === null` edits the WORKSPACE kit — the operator's own
 * brand, shown when the topbar says "All clients". A string edits that
 * client's kit. Nothing is inherited in either direction, so the panel
 * says which one you are looking at: the two are otherwise identical on
 * screen, and saving into the wrong one stays invisible until an image
 * comes back in the wrong colours.
 *
 * Saving the text fields is explicit (a Save button), not save-on-blur —
 * these values feed every subsequent generation, and silently mutating
 * them mid-experiment would be disorienting. Asset add/remove happen
 * immediately on action (there's nothing to "draft" about an upload), but
 * removing or replacing an asset is confirmed since it's destructive.
 */

export type BrandAssetKind = "LOGO" | "REFERENCE";

export interface BrandKitAssetView {
  id: string;
  kind: BrandAssetKind;
  url: string;
  label: string | null;
}

export interface BrandKitView {
  palette: string[];
  themeNotes: string | null;
  brandName: string | null;
  tagline: string | null;
  avoidNotes: string | null;
  assets: BrandKitAssetView[];
}

interface BrandKitPanelProps {
  /**
   * null is the workspace's own kit — the operator's brand, edited with
   * "All clients" selected. A string is that client's kit. Nothing
   * inherits between the two.
   */
  businessId: string | null;
  initialKit: BrandKitView | null;
  /**
   * Optional — called with the live kit whenever it changes (save, asset
   * added/removed). Added for Task 5: studio-client.tsx needs the current
   * kit to render brand toggles and build the generate request, and this
   * panel owns the kit's actual state privately. Additive and backward
   * compatible — every existing mount (there are none yet outside this
   * task, but the panel predates it) keeps working with it omitted.
   */
  onKitChange?: (kit: BrandKitView) => void;
  /**
   * "collapsible" renders the panel as a bordered, collapsible card with
   * its own header — the original inline placement. "bare" drops the card
   * and the collapse header entirely and always renders the body, for when
   * the panel sits inside something that already provides that chrome (the
   * studio's brand-kit drawer). Kept as a prop rather than two components
   * because the form, its state and every save path are identical; only
   * the wrapper differs.
   */
  chrome?: "collapsible" | "bare";
}

const MAX_PALETTE_ENTRIES = 6;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
// Mirrors MAX_IDENTITY_LENGTH in the service. Enforced here as a maxLength
// so the operator is stopped at the field rather than by a save error.
const MAX_IDENTITY_LENGTH = 200;
// Mirrors the server allowlist in src/app/api/brand-kit/assets/route.ts —
// SVG (and anything else outside this set) is rejected here too so the
// operator sees the reason immediately, though the server check is the
// one that actually matters for safety.
const ALLOWED_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function BrandKitPanel({
  businessId,
  initialKit,
  onKitChange,
  chrome = "collapsible",
}: BrandKitPanelProps) {
  // Which brand this panel is editing. The distinction is stated in the
  // UI rather than inferred, because the two look identical otherwise and
  // saving into the wrong one is invisible until an image comes back in
  // the wrong colours.
  const scopeNoun = businessId === null ? "workspace" : "client";

  const [expanded, setExpanded] = useState(true);
  const [kit, setKit] = useState<BrandKitView | null>(initialKit);

  // Notify the caller whenever the kit actually has a value. Runs on
  // mount too (when initialKit is non-null) so a parent that starts its
  // own state from a separate initialKit prop reference stays in sync
  // without needing a manual first-sync special case.
  useEffect(() => {
    if (kit) onKitChange?.(kit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit]);

  // ── Palette / notes draft state — only committed on explicit Save ──────
  const [palette, setPalette] = useState<string[]>(initialKit?.palette ?? []);
  const [themeNotes, setThemeNotes] = useState(initialKit?.themeNotes ?? "");
  const [brandName, setBrandName] = useState(initialKit?.brandName ?? "");
  const [tagline, setTagline] = useState(initialKit?.tagline ?? "");
  const [avoidNotes, setAvoidNotes] = useState(initialKit?.avoidNotes ?? "");
  const [newColor, setNewColor] = useState("#");
  const [paletteError, setPaletteError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    JSON.stringify(palette) !== JSON.stringify(kit?.palette ?? []) ||
    (themeNotes.trim() || null) !== (kit?.themeNotes ?? null) ||
    (brandName.trim() || null) !== (kit?.brandName ?? null) ||
    (tagline.trim() || null) !== (kit?.tagline ?? null) ||
    (avoidNotes.trim() || null) !== (kit?.avoidNotes ?? null);

  useEffect(() => {
    setSaved(false);
  }, [palette, themeNotes, brandName, tagline, avoidNotes]);

  function addColor() {
    setPaletteError(null);
    const c = newColor.trim();
    if (!HEX_COLOR.test(c)) {
      setPaletteError("Enter a hex colour like #1A2B3C.");
      return;
    }
    if (palette.some((p) => p.toLowerCase() === c.toLowerCase())) {
      setPaletteError("That colour is already in the palette.");
      return;
    }
    if (palette.length >= MAX_PALETTE_ENTRIES) {
      setPaletteError(`The palette is limited to ${MAX_PALETTE_ENTRIES} colours.`);
      return;
    }
    setPalette((p) => [...p, c]);
    setNewColor("#");
  }

  function removeColor(idx: number) {
    setPalette((p) => p.filter((_, i) => i !== idx));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/brand-kit", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          palette,
          themeNotes: themeNotes.trim() || null,
          brandName: brandName.trim() || null,
          tagline: tagline.trim() || null,
          avoidNotes: avoidNotes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setKit((prev) => ({
        palette: data.palette,
        themeNotes: data.themeNotes,
        brandName: data.brandName,
        tagline: data.tagline,
        avoidNotes: data.avoidNotes,
        assets: prev?.assets ?? [],
      }));
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function onAssetAdded(asset: BrandKitAssetView) {
    setKit((prev) => {
      const base = prev ?? {
        palette,
        themeNotes: themeNotes.trim() || null,
        brandName: brandName.trim() || null,
        tagline: tagline.trim() || null,
        avoidNotes: avoidNotes.trim() || null,
        assets: [],
      };
      const withoutReplacedLogo =
        asset.kind === "LOGO"
          ? base.assets.filter((a) => a.kind !== "LOGO")
          : base.assets;
      return { ...base, assets: [...withoutReplacedLogo, asset] };
    });
  }

  function onAssetRemoved(assetId: string) {
    setKit((prev) =>
      prev ? { ...prev, assets: prev.assets.filter((a) => a.id !== assetId) } : prev,
    );
  }

  const logo = kit?.assets.find((a) => a.kind === "LOGO") ?? null;
  const references = kit?.assets.filter((a) => a.kind === "REFERENCE") ?? [];
  const isEmpty =
    !kit &&
    palette.length === 0 &&
    !themeNotes.trim() &&
    !brandName.trim() &&
    !tagline.trim() &&
    !avoidNotes.trim();

  const bare = chrome === "bare";
  // Bare drops the card and the collapse header; the drawer around it
  // already supplies both, and nesting a second bordered, collapsible box
  // inside a panel reads as a mistake.
  const body = (
    <div className={bare ? "space-y-3" : "space-y-3 border-t border-border px-4 py-4"}>
          {isEmpty && (
            <div className="rounded-md border border-dashed border-border bg-surface px-4 py-5 text-center text-xs text-muted">
              {scopeNoun === "workspace"
                ? "No brand kit yet. Set your colours, name, tagline, theme notes, a logo and style references here, and every image you generate with no client selected will draw on them automatically."
                : "This client has no brand kit yet. Set their colours, name, tagline, theme notes, a logo and style references here — nothing is inherited from your own kit, so what you put here is theirs alone."}
            </div>
          )}

          {/* ── Palette ────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground">
              Colour palette{" "}
              <span className="font-normal text-subtle">
                (up to {MAX_PALETTE_ENTRIES})
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {palette.map((c, i) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-1 text-[11px]"
                >
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-border"
                    style={{ backgroundColor: c }}
                  />
                  <span className="font-mono">{c}</span>
                  <button
                    type="button"
                    onClick={() => removeColor(i)}
                    aria-label={`Remove ${c}`}
                    className="text-muted hover:text-danger"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {palette.length < MAX_PALETTE_ENTRIES && (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addColor();
                      }
                    }}
                    placeholder="#1A2B3C"
                    className="w-24 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    type="button"
                    onClick={addColor}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-surface-2"
                  >
                    <Plus className="h-3 w-3" />
                    Add
                  </button>
                </div>
              )}
            </div>
            {paletteError && (
              <p className="text-[11px] text-danger">{paletteError}</p>
            )}
          </div>

          {/* ── Text fields ────────────────────────────────────────────── */}
          {/* Two columns at width. Stacked full-bleed, four fields plus a
              line of help under each turned a short form into a tall
              scroll; the panel sits above the generate form, so its height
              is what pushes the actual work off screen. Help text is
              trimmed to what the placeholder cannot say on its own. */}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Brand name
              </label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                maxLength={MAX_IDENTITY_LENGTH}
                placeholder="e.g. Stackbinary"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <p className="text-[11px] text-subtle">
                Drawn as on-image text, so the model stops inventing one.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Tagline
              </label>
              <input
                type="text"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                maxLength={MAX_IDENTITY_LENGTH}
                placeholder="e.g. Ship it already"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Theme notes
              </label>
              <textarea
                rows={2}
                value={themeNotes}
                onChange={(e) => setThemeNotes(e.target.value)}
                placeholder="e.g. Warm festive lighting, clean product photography, no clutter"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Do-not list
              </label>
              <textarea
                rows={2}
                value={avoidNotes}
                onChange={(e) => setAvoidNotes(e.target.value)}
                maxLength={MAX_IDENTITY_LENGTH}
                placeholder="e.g. stock-photo people, drop shadows, competitor blue"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <p className="text-[11px] text-subtle">
                Skip the &quot;no&quot; — the prompt already adds it.
              </p>
            </div>
          </div>

          {/* ── Save ───────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-subtle">
              {saved
                ? "Saved."
                : dirty
                  ? "Unsaved changes."
                  : scopeNoun === "workspace"
                    ? "Feeds every image you generate with no client selected."
                    : "Feeds every image you generate for this client."}
            </p>
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              {saving ? "Saving…" : "Save brand kit"}
            </button>
          </div>
          {saveError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-danger">
              {saveError}
            </div>
          )}

          {/* ── Assets ─────────────────────────────────────────────────── */}
          {/* Logo and references side by side: both are small tile grids,
              and stacking them was the other half of the panel's height. */}
          <div className="grid gap-4 border-t border-border pt-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Logo</label>
              <LogoSlot
                businessId={businessId}
                logo={logo}
                onChanged={onAssetAdded}
                onRemoved={onAssetRemoved}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Style references
              </label>
              <ReferenceGrid
                businessId={businessId}
                references={references}
                onAdded={onAssetAdded}
                onRemoved={onAssetRemoved}
              />
            </div>
          </div>
    </div>
  );

  if (bare) return body;

  return (
    <div className="rounded-md border border-border bg-background">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold text-foreground">
            {scopeNoun === "workspace" ? "Your brand kit" : "Client brand kit"}
          </span>
          {!isEmpty && (
            <span className="text-[11px] text-subtle">
              {palette.length} colour{palette.length === 1 ? "" : "s"} ·{" "}
              {(kit?.assets.length ?? 0)} asset{(kit?.assets.length ?? 0) === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted" />
        )}
      </button>

      {expanded && body}
    </div>
  );
}

// ── Logo slot ──────────────────────────────────────────────────────────────

function LogoSlot({
  businessId,
  logo,
  onChanged,
  onRemoved,
}: {
  businessId: string | null;
  logo: BrandKitAssetView | null;
  onChanged: (asset: BrandKitAssetView) => void;
  onRemoved: (assetId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  // File picked while a logo already exists — replacing it is destructive
  // (the old one is gone for good), so it's held here pending confirmation
  // rather than uploaded immediately on selection.
  const [pendingReplaceFile, setPendingReplaceFile] = useState<File | null>(null);

  function onFileSelected(file: File | null) {
    if (!file) return;
    setError(null);
    const validation = validateImageFile(file);
    if (validation) {
      setError(validation);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (logo) {
      // Existing logo present — confirm before it's replaced.
      setPendingReplaceFile(file);
    } else {
      upload(file);
    }
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      // Empty string, not "null": the server folds a blank businessId to
      // the workspace scope, and FormData would stringify null literally.
      form.set("businessId", businessId ?? "");
      form.set("kind", "LOGO");
      form.set("file", file, file.name);
      const res = await fetch("/api/brand-kit/assets", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onChanged(data as BrandKitAssetView);
      setPendingReplaceFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    if (!logo) return;
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch("/api/brand-kit/assets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, assetId: logo.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onRemoved(logo.id);
      setConfirmRemove(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
        disabled={uploading}
        className="hidden"
      />
      {logo ? (
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logo.url}
            alt="Brand logo"
            className="h-14 w-14 shrink-0 rounded border border-border bg-background object-contain"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading || removing}
              className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "Replace"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              disabled={uploading || removing}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-danger hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-surface px-3 py-3 text-[11px] text-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ImagePlus className="h-3.5 w-3.5 text-subtle" />
          )}
          {uploading ? "Uploading…" : "Upload logo"}
        </button>
      )}
      {error && <p className="text-[11px] text-danger">{error}</p>}

      <ConfirmModal
        open={confirmRemove}
        title="Remove logo"
        body="This deletes the logo from the brand kit. It won't be used in future generations for this client."
        variant="danger"
        confirmLabel="Remove"
        loading={removing}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={remove}
      />

      <ConfirmModal
        open={pendingReplaceFile !== null}
        title="Replace logo"
        body="This replaces the current logo. The old one is permanently removed and can't be recovered."
        variant="danger"
        confirmLabel="Replace"
        loading={uploading}
        onCancel={() => {
          setPendingReplaceFile(null);
          if (inputRef.current) inputRef.current.value = "";
        }}
        onConfirm={() => {
          if (pendingReplaceFile) upload(pendingReplaceFile);
        }}
      />
    </div>
  );
}

// ── Reference grid ─────────────────────────────────────────────────────────

function ReferenceGrid({
  businessId,
  references,
  onAdded,
  onRemoved,
}: {
  businessId: string | null;
  references: BrandKitAssetView[];
  onAdded: (asset: BrandKitAssetView) => void;
  onRemoved: (assetId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  async function upload(file: File) {
    setError(null);
    const validation = validateImageFile(file);
    if (validation) {
      setError(validation);
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      // Empty string, not "null": the server folds a blank businessId to
      // the workspace scope, and FormData would stringify null literally.
      form.set("businessId", businessId ?? "");
      form.set("kind", "REFERENCE");
      form.set("file", file, file.name);
      const res = await fetch("/api/brand-kit/assets", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onAdded(data as BrandKitAssetView);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    if (!pendingRemoveId) return;
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch("/api/brand-kit/assets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, assetId: pendingRemoveId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onRemoved(pendingRemoveId);
      setPendingRemoveId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        {references.map((ref) => (
          <div
            key={ref.id}
            className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-border bg-surface"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ref.url}
              alt={ref.label ?? "Style reference"}
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              onClick={() => setPendingRemoveId(ref.id)}
              aria-label="Remove reference"
              className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
          disabled={uploading}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={cn(
            "flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-surface text-[10px] text-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4 text-subtle" />
          )}
          {uploading ? "Uploading…" : "Add"}
        </button>
      </div>
      {error && <p className="text-[11px] text-danger">{error}</p>}

      <ConfirmModal
        open={pendingRemoveId !== null}
        title="Remove reference"
        body="This deletes the style reference from the brand kit."
        variant="danger"
        confirmLabel="Remove"
        loading={removing}
        onCancel={() => setPendingRemoveId(null)}
        onConfirm={remove}
      />
    </div>
  );
}

function validateImageFile(file: File): string | null {
  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    return "Pick a PNG, JPEG, or WEBP image file.";
  }
  if (file.size > MAX_ASSET_BYTES) {
    return `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_ASSET_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}
