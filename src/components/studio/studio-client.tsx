"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Loader2,
  Palette,
  Sparkles,
  X,
} from "lucide-react";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { SlideOver } from "@/components/ui/slide-over";
import { BrandKitPanel, type BrandKitView } from "@/components/studio/brand-kit-panel";
import {
  VariantCard,
  type AdImageVariant,
  type ImageQuality,
  type SavedVariantRef,
  type StudioAdAccount,
} from "@/components/studio/variant-card";
import {
  MAX_REFERENCES,
  type ReferenceRole,
  type StudioBrand,
  type StudioToggles,
} from "@/server/services/ai/studio-prompt";
import { setUnsavedGuard } from "@/lib/unsaved-guard";
import { cn } from "@/lib/utils";

/**
 * StudioClient — the interactive half of /dashboard/studio. Owns the
 * generation form, the brand-kit state lifted out of BrandKitPanel (see
 * that component's onKitChange), the reference/MAX_REFERENCES bookkeeping,
 * results, and the unsaved-variants navigation guard.
 *
 * Talks to /api/ai/ad-image/generate and /api/ai/ad-image/tweak directly,
 * plus (via VariantCard, src/components/studio/variant-card.tsx) POST
 * /api/images to save a chosen variant into an ad account's Creative
 * library — that file also owns the Tweak flow now; see its header for why
 * it was split out.
 */

interface UploadRef {
  id: string;
  file: File;
  dataUrl: string;
  b64: string;
  role: ReferenceRole;
}

const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "gpt-image-2", label: "gpt-image-2 — newest, strongest design sense" },
  { value: "gpt-image-1.5", label: "gpt-image-1.5 — keeps an uploaded product faithful" },
  { value: "gpt-image-1", label: "gpt-image-1 — older, cheaper" },
  { value: "chatgpt-image-latest", label: "chatgpt-image-latest — mirrors the ChatGPT app" },
];

// Mirrors generate-ad-image.ts's supportsInputFidelity() allowlist. Task 5
// must not change which models that function accepts, and it isn't
// exported for client use, so this list is kept in sync by hand rather
// than reimplemented — it only gates which warning copy shows, never what
// gets sent to the server (the route/service decide that independently).
const FIDELITY_MODELS = new Set(["gpt-image-1", "gpt-image-1.5"]);

// Verbatim per the Task 5 brief — always this exact copy when a product
// reference is attached and the model can't pin fidelity, even if the
// offending model isn't literally gpt-image-2.
const FIDELITY_WARNING =
  "gpt-image-2 can't pin product fidelity — the product will be reinterpreted. Use gpt-image-1.5 to keep it faithful.";

// Rough per-image cost, mirroring the labels AiStudioPanel shows next to
// its own quality selector (src/components/ads/ai-studio-panel.tsx). Not
// exported there, so duplicated rather than imported.
const COST_BY_QUALITY: Record<ImageQuality, number> = {
  low: 1.5,
  medium: 4,
  high: 15,
};

// Column counts keyed by how many variants came back, so one image renders
// large instead of marooned in a quarter-width cell.
const RESULT_GRID: Record<number, string> = {
  1: "grid-cols-1 max-w-xl",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
  4: "grid-cols-2 xl:grid-cols-4",
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// These bytes end up as an OpenAI images.edit() reference (see
// generate-ad-image.ts). PNG/JPEG/WEBP are tolerated even when
// mislabelled; SVG or GIF are not and would otherwise surface as an
// opaque 400 mid-generation instead of a clear upfront rejection here.
const ALLOWED_UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const ROLE_LABEL: Record<ReferenceRole, string> = {
  product: "Product",
  style: "Style",
  logo: "Logo",
};

interface StudioClientProps {
  businessId: string | null;
  initialKit: BrandKitView | null;
  // Ad accounts eligible for Save-to-library: the active client's accounts
  // when one is selected, otherwise every selectedForSync account (mirrors
  // the "All clients" behaviour of /dashboard/accounts). Resolved
  // server-side in page.tsx since it's a straightforward Prisma query and
  // the page already resolves businessId there.
  adAccounts: StudioAdAccount[];
}

export function StudioClient({
  businessId,
  initialKit,
  adAccounts,
}: StudioClientProps) {
  const router = useRouter();
  // Kit state is lifted out of BrandKitPanel (see the onKitChange addition
  // on that component, added for exactly this) because the generation
  // form needs the LIVE kit — palette, theme notes, logo, references — to
  // render the brand toggles and to build the `brand` payload sent to the
  // generate route. Without lifting this, editing the kit in-panel
  // wouldn't affect a generation until the page reloaded.
  const [kit, setKit] = useState<BrandKitView | null>(initialKit);
  // The kit editor lives in a drawer: editing a brand is occasional,
  // generating is constant, so the editor shouldn't pay rent on the layout.
  const [kitOpen, setKitOpen] = useState(false);

  // ── Form state ──────────────────────────────────────────────────────
  const [brief, setBrief] = useState("");
  const [model, setModel] = useState("gpt-image-1.5");
  const [quality, setQuality] = useState<ImageQuality>("medium");
  const [count, setCount] = useState(1);
  const [useColours, setUseColours] = useState(true);
  const [useTheme, setUseTheme] = useState(true);
  const [useLogo, setUseLogo] = useState(true);
  // Brand name and tagline share one switch: they are one piece of copy,
  // and splitting them would mean four checkboxes for what the operator
  // thinks of as "put my brand on it".
  const [useIdentity, setUseIdentity] = useState(true);
  const [useAvoid, setUseAvoid] = useState(true);
  const [selectedRefIds, setSelectedRefIds] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<UploadRef[]>([]);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const referenceAssets = useMemo(
    () => kit?.assets.filter((a) => a.kind === "REFERENCE") ?? [],
    [kit],
  );
  const logoAsset = kit?.assets.find((a) => a.kind === "LOGO") ?? null;
  // Presence flags: a toggle is rendered only when the kit has something
  // for it to act on. Toggling a field the kit doesn't hold changed
  // nothing anyway — buildStudioPrompt gates on the field's presence too —
  // so a disabled checkbox was noise standing in for a state the panel
  // above already reports.
  const hasIdentity = Boolean(kit?.brandName?.trim() || kit?.tagline?.trim());
  const hasAvoid = Boolean(kit?.avoidNotes?.trim());
  const hasPalette = (kit?.palette.length ?? 0) > 0;
  const hasTheme = Boolean(kit?.themeNotes?.trim());
  const hasAnyBrandInput =
    hasPalette ||
    hasTheme ||
    hasIdentity ||
    hasAvoid ||
    Boolean(logoAsset) ||
    referenceAssets.length > 0;

  // Default every kit reference ON whenever the underlying SET of
  // reference ids changes (kit loaded, an asset added/removed) — but
  // otherwise leave the user's own checkbox choices alone, so unchecking
  // one doesn't get silently reverted on an unrelated re-render.
  const refIdsKey = referenceAssets.map((a) => a.id).join(",");
  useEffect(() => {
    setSelectedRefIds(new Set(referenceAssets.map((a) => a.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refIdsKey]);

  // ── Reference candidates, in priority order ────────────────────────
  // Uploads first (the most deliberate, just-taken action this session),
  // then checked kit references, then the logo. When the total exceeds
  // MAX_REFERENCES the tail is dropped — the banner below names exactly
  // what's being sent and what got cut, rather than silently dropping one.
  const candidates = useMemo(() => {
    type Candidate = {
      role: ReferenceRole;
      label: string;
      // Resolves to the real content type alongside the bytes where it's
      // known, so generate-ad-image.ts can label the reference correctly
      // for OpenAI instead of always claiming "image/png" — an upload's
      // File.type is known directly; a kit asset's is read off /api/media's
      // response content-type, which mirrors what's actually stored.
      resolve: () => Promise<{ b64: string; mimeType?: string }>;
    };
    const fromUploads: Candidate[] = uploads.map((u) => ({
      role: u.role,
      label: `${u.file.name} (${ROLE_LABEL[u.role]} upload)`,
      resolve: async () => ({ b64: u.b64, mimeType: u.file.type || undefined }),
    }));
    const fromKitRefs: Candidate[] = referenceAssets
      .filter((a) => selectedRefIds.has(a.id))
      .map((a) => ({
        role: "style" as ReferenceRole,
        label: `${a.label ?? "Style reference"} (kit)`,
        resolve: () => urlToReference(a.url),
      }));
    const fromLogo: Candidate[] =
      useLogo && logoAsset
        ? [
            {
              role: "logo" as ReferenceRole,
              label: "Logo (kit)",
              resolve: () => urlToReference(logoAsset.url),
            },
          ]
        : [];
    return [...fromUploads, ...fromKitRefs, ...fromLogo];
  }, [uploads, referenceAssets, selectedRefIds, useLogo, logoAsset]);

  const sending = candidates.slice(0, MAX_REFERENCES);
  const excluded = candidates.slice(MAX_REFERENCES);
  const hasProductReference = sending.some((c) => c.role === "product");
  const showFidelityWarning = hasProductReference && !FIDELITY_MODELS.has(model);

  // ── Results ─────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variants, setVariants] = useState<AdImageVariant[]>([]);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  // A variant counts as "unsaved" until it carries a `saved` ref (set by
  // markSaved once POST /api/images returns a hash) — see variant-card.tsx.
  // A tweak replaces the variant with a fresh, unsaved one at the same
  // index, which is correct: the bytes on screen changed, so the prior
  // save no longer describes what's there.
  const hasUnsaved = variants.some((v) => !v.saved);
  const estCost = COST_BY_QUALITY[quality] * count;

  // ── Unsaved-variants guard ──────────────────────────────────────────
  // Variants are base64 in memory only until Saved, and the user may have
  // just paid OpenAI for up to four `high`-quality generations. Losing that
  // to an accidental tab
  // close or a sidebar click would be a real cost, not just an annoyance,
  // so this needs three separate guards, each covering a navigation path
  // the others can't see:
  //   1. beforeunload — reload/close/back-forward leaving the app.
  //   2. an in-app <a>-click interceptor — the App Router's client-side
  //      navigation doesn't fire beforeunload.
  //   3. src/lib/unsaved-guard.ts — the topbar AccountSwitcher navigates
  //      via router.push() from a <button>, which neither (1) nor (2) can
  //      see. Registering here lets that shared, page-agnostic component
  //      consult "is there unsaved work right now" without knowing
  //      anything about Ad Studio.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasUnsaved) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsaved]);

  useEffect(() => {
    setUnsavedGuard(() => hasUnsaved);
    // Clear on unmount (and before every re-registration) so a stale
    // guard from a previous mount — or from navigating away entirely —
    // can never block navigation on a page that isn't Ad Studio.
    return () => setUnsavedGuard(null);
  }, [hasUnsaved]);

  const [pendingHref, setPendingHref] = useState<string | null>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!hasUnsaved) return;
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      const href = anchor?.getAttribute("href");
      if (!anchor || !href || href.startsWith("#")) return;
      // Only intercept plain same-tab, same-origin, non-download in-app
      // navigations. Anything else — target="_blank" (open in a new tab),
      // a download attribute, mailto:/tel:, or a cross-origin href — must
      // behave exactly as if this listener weren't here: swallowing those
      // and replacing the current tab via window.location.assign silently
      // turned "open in a new tab" into "leave this page", and would have
      // turned a future download link into a navigation instead of a
      // download.
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      setPendingHref(href);
    }
    // Capture phase so this runs before Next's Link click handler.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [hasUnsaved]);

  // ── Uploads ─────────────────────────────────────────────────────────
  function addUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    for (const file of Array.from(files)) {
      if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
        setUploadError(`${file.name}: pick a PNG, JPEG, or WEBP image file.`);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setUploadError(
          `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        );
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? "");
        const commaIdx = dataUrl.indexOf(",");
        const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
        setUploads((prev) => [
          ...prev,
          { id: crypto.randomUUID(), file, dataUrl, b64, role: "product" },
        ]);
      };
      reader.onerror = () => setUploadError(`Couldn't read ${file.name}.`);
      reader.readAsDataURL(file);
    }
    if (uploadInputRef.current) uploadInputRef.current.value = "";
  }

  function removeUpload(id: string) {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  }

  function setUploadRole(id: string, role: ReferenceRole) {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
  }

  function toggleKitRef(id: string) {
    setSelectedRefIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Generate ────────────────────────────────────────────────────────
  async function generate() {
    if (!brief.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const resolvedReferences = await Promise.all(
        sending.map(async (c) => {
          const { b64, mimeType } = await c.resolve();
          return { b64, role: c.role, ...(mimeType ? { mimeType } : {}) };
        }),
      );
      const res = await fetch("/api/ai/ad-image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: brief.trim(),
          count,
          quality,
          model,
          references: resolvedReferences,
          brand: (kit
            ? {
                palette: kit.palette,
                themeNotes: kit.themeNotes,
                brandName: kit.brandName,
                tagline: kit.tagline,
                avoidNotes: kit.avoidNotes,
              }
            : null) satisfies StudioBrand | null,
          toggles: {
            useColours,
            useTheme,
            useLogo,
            useIdentity,
            useAvoid,
          } satisfies StudioToggles,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      // A fresh generation replaces the results wholesale, same as the
      // existing AiStudioPanel — only a request failure (the catch below)
      // leaves prior variants in place.
      setVariants((data.variants as AdImageVariant[]) ?? []);
      setPrompt(typeof data.prompt === "string" ? data.prompt : null);
    } catch (err) {
      // Inline only — brief, toggles, uploads and any previously
      // generated variants stay exactly as they were so a transient
      // failure doesn't cost the user their setup or an earlier success.
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  function replaceVariant(idx: number, next: AdImageVariant) {
    setVariants((prev) => {
      const out = [...prev];
      out[idx] = next;
      return out;
    });
  }

  function markSaved(idx: number, saved: SavedVariantRef) {
    setVariants((prev) => {
      const out = [...prev];
      out[idx] = { ...out[idx], saved };
      return out;
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Sparkles className="h-5 w-5 text-accent" />
          Ad studio
        </h1>
        <p className="text-sm text-muted">
          {businessId
            ? "Generate on-brand ad imagery from a one-line brief, drawing on this client’s own brand kit."
            : "Generate on-brand ad imagery from a one-line brief, drawing on your brand kit. Pick a client in the switcher above to use theirs instead."}
        </p>
      </div>

      {/* Controls in a sticky rail, output on a canvas beside it. Stacked
          top-to-bottom, the form was a tall block you scrolled past to
          reach your own images — wrong priority for a tool whose point is
          looking at output — and it put Generate out of reach for the next
          attempt. The rail stays put; only the canvas scrolls. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <aside className="space-y-3 rounded-md border border-border bg-background p-4 lg:sticky lg:top-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Brief</label>
              <textarea
                rows={3}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="e.g. Diwali offer, FLAT 50% OFF, SHOP NOW. Festive scene, warm golden-hour light, diyas & marigolds."
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            {/* Model gets its own row — its option labels are sentences,
                not words, and a third of a 380px rail truncates them to
                "gpt-image-1.5 — keeps an uploaded pr…". */}
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Model</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {MODEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Quality</label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as ImageQuality)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Count</label>
                <select
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              </div>
            </div>

            {showFidelityWarning && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {FIDELITY_WARNING}
              </div>
            )}

            {/* ── Reference uploads ───────────────────────────────────── */}
            <div className="space-y-1.5 border-t border-border pt-3">
              <label className="text-xs font-medium text-foreground">
                Reference uploads
              </label>
              <div className="flex flex-wrap gap-2">
                {uploads.map((u) => (
                  <div
                    key={u.id}
                    className="w-28 space-y-1 rounded-md border border-border bg-surface p-1.5"
                  >
                    <div className="relative h-16 w-full overflow-hidden rounded bg-surface-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={u.dataUrl}
                        alt={u.file.name}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeUpload(u.id)}
                        aria-label={`Remove ${u.file.name}`}
                        className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <select
                      value={u.role}
                      onChange={(e) =>
                        setUploadRole(u.id, e.target.value as ReferenceRole)
                      }
                      className="w-full rounded border border-border bg-background px-1 py-0.5 text-[10px]"
                    >
                      <option value="product">Product</option>
                      <option value="style">Style</option>
                      <option value="logo">Logo</option>
                    </select>
                  </div>
                ))}
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => addUploadFiles(e.target.files)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  className="flex h-16 w-28 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-surface text-[10px] text-muted hover:bg-surface-2"
                >
                  <ImagePlus className="h-4 w-4 text-subtle" />
                  Add reference
                </button>
              </div>
              {uploadError && (
                <p className="text-[11px] text-danger">{uploadError}</p>
              )}
            </div>

            {/* ── Brand toggles ───────────────────────────────────────── */}
            {/* Only what the kit can actually act on. Five permanently
                greyed-out checkboxes reading "(none in kit)" competed for
                attention before there was anything to toggle, and pushed
                the row onto two lines; an empty kit now says so in one
                line instead. */}
            <div className="space-y-1.5 border-t border-border pt-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-foreground">
                  {businessId ? "Client brand kit" : "Your brand kit"}
                </label>
                <button
                  type="button"
                  onClick={() => setKitOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted hover:bg-surface-2 hover:text-foreground"
                >
                  <Palette className="h-3 w-3" />
                  Edit
                </button>
              </div>
              {hasAnyBrandInput ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                  {hasPalette && (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={useColours}
                        onChange={(e) => setUseColours(e.target.checked)}
                      />
                      Use brand colours
                    </label>
                  )}
                  {hasTheme && (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={useTheme}
                        onChange={(e) => setUseTheme(e.target.checked)}
                      />
                      Apply theme notes
                    </label>
                  )}
                  {hasIdentity && (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={useIdentity}
                        onChange={(e) => setUseIdentity(e.target.checked)}
                      />
                      Use brand name &amp; tagline
                    </label>
                  )}
                  {logoAsset && (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={useLogo}
                        onChange={(e) => setUseLogo(e.target.checked)}
                      />
                      Include logo
                    </label>
                  )}
                  {hasAvoid && (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={useAvoid}
                        onChange={(e) => setUseAvoid(e.target.checked)}
                      />
                      Apply do-not list
                    </label>
                  )}
                  {referenceAssets.map((a) => (
                    <label key={a.id} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={selectedRefIds.has(a.id)}
                        onChange={() => toggleKitRef(a.id)}
                      />
                      {a.label ?? "Style reference"}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-subtle">
                  Empty — add colours, a name or a logo to draw on them here.
                </p>
              )}
            </div>

            {excluded.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Only {MAX_REFERENCES} of {candidates.length} references can be
                sent. Sending: {sending.map((c) => c.label).join(", ")}. Not
                sent: {excluded.map((c) => c.label).join(", ")}.
              </div>
            )}

            <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
              <p className="text-[11px] text-subtle">
                Estimated cost: ~₹{estCost.toFixed(1)} ({count}×{" "}
                {quality} quality)
              </p>
              <button
                type="button"
                onClick={generate}
                disabled={busy || !brief.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy ? "Generating…" : "Generate"}
              </button>
            </div>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
                {error}
              </div>
            )}
        </aside>

        {/* ── Results canvas ───────────────────────────────────────────── */}
        <section className="min-w-0">
          {variants.length === 0 ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-surface px-6 text-center">
              <Sparkles className="h-6 w-6 text-subtle" />
              <p className="mt-2 text-sm font-medium text-foreground">
                Nothing generated yet
              </p>
              <p className="mt-1 max-w-xs text-xs text-muted">
                Describe the ad you want on the left and hit Generate. Variants
                appear here, and stay until you leave the page.
              </p>
            </div>
          ) : (
            <div className="space-y-2 rounded-md border border-border bg-background p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">
                  Results
                </h2>
                {prompt && (
                  <button
                    type="button"
                    onClick={() => setShowPrompt((v) => !v)}
                    className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-foreground"
                  >
                    {showPrompt ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                    Prompt sent
                  </button>
                )}
              </div>
              {showPrompt && prompt && (
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-2 text-[11px] text-muted">
                  {prompt}
                </pre>
              )}
              {/* Sized to what was actually generated. A fixed four-column
                  grid left a single variant sitting in a quarter of the row
                  with three empty cells beside it. */}
              <div className={cn("grid gap-3", RESULT_GRID[variants.length] ?? RESULT_GRID[4])}>
                {variants.map((v, i) => (
                  <VariantCard
                    key={i}
                    index={i}
                    variant={v}
                    brief={brief}
                    quality={quality}
                    model={model}
                    adAccounts={adAccounts}
                    onReplace={(next) => replaceVariant(i, next)}
                    onSaved={(saved) => markSaved(i, saved)}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <SlideOver
        open={kitOpen}
        onClose={() => setKitOpen(false)}
        title={businessId ? "Client brand kit" : "Your brand kit"}
        subtitle={
          businessId
            ? "Feeds every image you generate for this client."
            : "Feeds every image you generate with no client selected."
        }
      >
        {/* Mounted in both scopes, and mounted even while the drawer is
            shut — SlideOver translates rather than unmounting, so a
            half-typed palette survives an accidental Escape. A null
            businessId is not "no kit available": it is the workspace's own
            kit, which is what most generations here actually use. */}
        <BrandKitPanel
          businessId={businessId}
          initialKit={initialKit}
          onKitChange={setKit}
          chrome="bare"
        />
      </SlideOver>

      <ConfirmModal
        open={pendingHref !== null}
        title="Leave without saving?"
        body="You have generated images that haven't been saved yet. Leaving this page loses them — you'd have to generate again (and pay again) to get them back."
        variant="danger"
        confirmLabel="Leave anyway"
        onCancel={() => setPendingHref(null)}
        onConfirm={() => {
          const href = pendingHref;
          setPendingHref(null);
          // These are all confirmed same-origin, same-tab, non-download
          // links (see the click interceptor above), so client-side
          // routing is correct here — a full page load would needlessly
          // throw away the App Router's cache.
          if (href) router.push(href);
        }}
      />
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

async function urlToReference(url: string): Promise<{ b64: string; mimeType?: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Couldn't load reference image (HTTP ${res.status})`);
  }
  // /api/media/<path> serves back the content type BrandAsset actually
  // stored, so this is the true type, not a guess — it's what lets
  // generate-ad-image.ts label the reference correctly instead of always
  // claiming "image/png".
  const mimeType = res.headers.get("content-type") ?? undefined;
  const blob = await res.blob();
  const b64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const commaIdx = dataUrl.indexOf(",");
      resolve(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
    };
    reader.onerror = () => reject(new Error("Couldn't read reference image."));
    reader.readAsDataURL(blob);
  });
  return { b64, mimeType };
}
