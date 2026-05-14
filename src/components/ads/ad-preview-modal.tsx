"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AD_PLACEMENTS,
  DEFAULT_PLACEMENT_FORMAT,
  getPlacementLabel,
} from "@/lib/meta/ad-placements";

interface AdPreviewModalProps {
  open: boolean;
  metaAdId: string;
  adName: string;
  onClose: () => void;
}

interface PreviewCell {
  format: string;
  label: string;
  html: string | null;
  error?: string;
}

type CacheEntry =
  | { kind: "loading" }
  | { kind: "ok"; cell: PreviewCell }
  | { kind: "error"; message: string };

/**
 * Renders Meta's iframe-snippet HTML imperatively — innerHTML is set ONCE
 * via useEffect when `html` first becomes available, and never re-touched
 * on subsequent renders. Direct use of dangerouslySetInnerHTML in JSX
 * causes the browser to destroy and recreate the iframe on every React
 * reconciliation pass, which means every parent re-render fires a fresh
 * Meta-side iframe load. Setting it once eliminates that whole class of
 * needless network traffic.
 */
function PreviewFrame({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastHtmlRef = useRef<string | null>(null);

  useEffect(() => {
    if (ref.current && lastHtmlRef.current !== html) {
      ref.current.innerHTML = html;
      lastHtmlRef.current = html;
    }
  }, [html]);

  return <div ref={ref} className="ad-preview-frame" />;
}

/**
 * Ad preview — lazy and cost-aware.
 *
 * Behaviour:
 *  • Opens with ONE placement loaded (Facebook Feed) — single Meta API call.
 *  • Placement dropdown switches the active card. Already-fetched placements
 *    are cached client-side; switching back costs zero calls.
 *  • "Show all placements" loads the remaining four in parallel and flips
 *    the modal into the side-by-side grid (the cross-placement scan that
 *    Meta's UI doesn't offer).
 *
 * Dedup uses a ref, not the cache state — React batches setState across
 * effects, so two effects firing in the same tick can both see an "empty"
 * cache and both kick off a fetch. The ref is mutated synchronously so the
 * second caller sees the format is already in-flight.
 */
export function AdPreviewModal({
  open,
  metaAdId,
  adName,
  onClose,
}: AdPreviewModalProps) {
  const [mounted, setMounted] = useState(false);
  const [activeFormat, setActiveFormat] = useState<string>(
    DEFAULT_PLACEMENT_FORMAT,
  );
  const [showAll, setShowAll] = useState(false);
  const [cache, setCache] = useState<Record<string, CacheEntry>>({});
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Synchronous dedup: formats that are in-flight or already resolved this
  // session. Survives across batched state updates that the cache state
  // can't (since setCache is async-committed).
  const inFlightOrLoadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Close dropdown when clicking outside.
  useEffect(() => {
    if (!dropdownOpen) return;
    function onClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [dropdownOpen]);

  // Reset on close — ensures the next open starts fresh (no stale cache
  // from a previous ad). Done on close, not on open, so that the open-time
  // fetch effect doesn't race with a same-tick state reset.
  useEffect(() => {
    if (open) return;
    setActiveFormat(DEFAULT_PLACEMENT_FORMAT);
    setShowAll(false);
    // Functional setCache so we bail out when already empty — avoids a
    // pointless re-render on first mount.
    setCache((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    setDropdownOpen(false);
    inFlightOrLoadedRef.current = new Set();
  }, [open]);

  const fetchFormats = useCallback(
    async (formats: string[]) => {
      const toFetch = formats.filter(
        (f) => !inFlightOrLoadedRef.current.has(f),
      );
      if (toFetch.length === 0) {
        if (process.env.NODE_ENV !== "production") {
          console.debug(
            `[ad-preview] skip — already in-flight/loaded:`,
            formats.join(","),
          );
        }
        return;
      }
      // Mark in-flight synchronously — any concurrent effect that sees this
      // ref will skip these formats.
      for (const f of toFetch) inFlightOrLoadedRef.current.add(f);

      if (process.env.NODE_ENV !== "production") {
        console.debug(
          `[ad-preview] fetching:`,
          toFetch.join(","),
          `for ad ${metaAdId}`,
        );
      }

      setCache((prev) => {
        const next = { ...prev };
        for (const f of toFetch) next[f] = { kind: "loading" };
        return next;
      });

      try {
        const res = await fetch(
          `/api/ads/${metaAdId}/previews?formats=${toFetch.join(",")}`,
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error ?? `HTTP ${res.status}`);
        }
        const previews: PreviewCell[] = Array.isArray(data.previews)
          ? data.previews
          : [];
        setCache((prev) => {
          const next = { ...prev };
          for (const f of toFetch) {
            const p = previews.find((x) => x.format === f);
            next[f] = p
              ? { kind: "ok", cell: p }
              : { kind: "error", message: "Placement missing from response" };
          }
          return next;
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load previews";
        // Clear in-flight tracking for failed formats so the user can retry
        // by re-selecting the placement.
        for (const f of toFetch) inFlightOrLoadedRef.current.delete(f);
        setCache((prev) => {
          const next = { ...prev };
          for (const f of toFetch) {
            if (next[f]?.kind !== "ok") next[f] = { kind: "error", message };
          }
          return next;
        });
      }
    },
    [metaAdId],
  );

  // Lazy-fetch the active placement. Handles both the initial open and
  // subsequent dropdown changes. Dedup happens inside fetchFormats.
  useEffect(() => {
    if (!open || showAll) return;
    fetchFormats([activeFormat]);
  }, [open, showAll, activeFormat, fetchFormats]);

  function handleShowAll() {
    setShowAll(true);
    fetchFormats(AD_PLACEMENTS.map((p) => p.format));
  }

  function renderCard(format: string) {
    const entry = cache[format];
    const label = getPlacementLabel(format);
    return (
      <div
        key={format}
        className="overflow-hidden rounded-lg border border-border bg-surface"
      >
        <div className="border-b border-border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle">
          {label}
        </div>
        <div className="min-h-[420px] bg-background p-2">
          {!entry || entry.kind === "loading" ? (
            <div className="flex h-[400px] items-center justify-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : entry.kind === "error" ? (
            <div className="flex h-[400px] items-center justify-center px-3 text-center text-xs text-subtle">
              Couldn&apos;t render: {entry.message}
            </div>
          ) : entry.cell.html ? (
            <PreviewFrame html={entry.cell.html} />
          ) : (
            <div className="flex h-[400px] items-center justify-center px-3 text-center text-xs text-subtle">
              {entry.cell.error
                ? `Couldn't render: ${entry.cell.error}`
                : "Not available for this placement"}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ad-preview-title"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[90vh] w-full flex-col rounded-lg border border-border bg-background shadow-lg",
          showAll ? "max-w-6xl" : "max-w-2xl",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h2
              id="ad-preview-title"
              className="truncate text-sm font-semibold tracking-tight"
            >
              {adName}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {showAll ? "Across placements" : "Preview"} · ad id{" "}
              <span className="font-mono">{metaAdId}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-2">
          {showAll ? (
            <>
              <span className="text-xs text-muted">
                Showing all {AD_PLACEMENTS.length} placements
              </span>
              <button
                type="button"
                onClick={() => setShowAll(false)}
                className="inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-surface-2"
              >
                Single placement
              </button>
            </>
          ) : (
            <>
              <div ref={dropdownRef} className="relative">
                <button
                  type="button"
                  onClick={() => setDropdownOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-sm font-medium hover:bg-surface-2"
                >
                  {getPlacementLabel(activeFormat)}
                  <ChevronDown className="h-3.5 w-3.5 text-subtle" />
                </button>
                {dropdownOpen && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-md border border-border bg-background shadow-md">
                    <ul className="py-1">
                      {AD_PLACEMENTS.map((p) => {
                        const isActive = p.format === activeFormat;
                        const isLoaded = cache[p.format]?.kind === "ok";
                        return (
                          <li key={p.format}>
                            <button
                              type="button"
                              onClick={() => {
                                setDropdownOpen(false);
                                // Explicit no-op when clicking the currently
                                // active placement — guards against any edge
                                // case where setActiveFormat with the same
                                // value might still trigger downstream work.
                                if (p.format === activeFormat) return;
                                setActiveFormat(p.format);
                              }}
                              className={cn(
                                "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-sm hover:bg-surface-2",
                                isActive && "bg-surface-2",
                              )}
                            >
                              <span>{p.label}</span>
                              {isLoaded && !isActive && (
                                <span
                                  className="text-[10px] text-subtle"
                                  title="Already fetched — no extra API call"
                                >
                                  cached
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleShowAll}
                title="Render every placement side-by-side"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-sm font-medium hover:bg-surface-2"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Show all placements
              </button>
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Render each loaded placement in its own div and toggle visibility
              with CSS. Swapping content in a single div via dangerouslySetInnerHTML
              causes the browser to destroy + recreate iframes, which triggers
              fresh Meta-side iframe loads every time the user switches placements.
              Keeping divs mounted preserves the iframe DOM nodes across switches.
            */}
          <div
            className={cn(
              showAll
                ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                : "mx-auto max-w-md",
            )}
          >
            {AD_PLACEMENTS.map((p) => {
              const isActive = p.format === activeFormat;
              const isVisible = showAll || isActive;
              const entry = cache[p.format];
              // Skip placements that haven't been fetched AND aren't visible —
              // no point keeping a DOM node around for content the user
              // hasn't asked for yet.
              if (!entry && !isVisible) return null;
              return (
                <div key={p.format} className={cn(!isVisible && "hidden")}>
                  {renderCard(p.format)}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-[11px] text-subtle">
          <span>
            Previews are rendered by Meta — the actual creative as it appears
            on each placement.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2"
          >
            Close
          </button>
        </div>
      </div>
      <style jsx global>{`
        .ad-preview-frame iframe {
          width: 100% !important;
          min-height: 400px;
          border: 0;
          display: block;
        }
      `}</style>
    </div>,
    document.body,
  );
}
