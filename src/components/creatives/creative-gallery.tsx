"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ExternalLink,
  Image as ImageIcon,
  Play,
  ScrollText,
  Sparkles,
  Video as VideoIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DeleteButton } from "@/components/common/delete-button";

/**
 * The creative gallery — the swipe file this tool was always implying.
 *
 * A creative is the single most looked-at object in a marketing tool, and
 * until this component it was a dead card: no click target, its AI tags and
 * performance invisible, its video unplayable. The design rule here is
 * MEDIA FIRST, INTELLIGENCE SECOND, CHROME LAST — the thumbnail is the
 * card; everything the platform knows about the creative (hook, angle,
 * funnel stage, transcript, spend, CPA) lives one click away in the
 * detail view, where a video actually plays.
 *
 * Honesty rule carried over from the patterns panel: performance renders
 * only when the creative has spend. "₹0 · ROAS 0.00" on a never-delivered
 * creative reads as failure; "never delivered" is the truth.
 */

export interface GalleryItem {
  id: string;
  metaCreativeId: string;
  name: string | null;
  title: string | null;
  body: string | null;
  ctaLabel: string | null;
  linkUrl: string | null;
  status: string | null;
  thumb: string | null;
  isVideo: boolean;
  videoSourceUrl: string | null;
  transcript: string | null;
  accountLabel: string;
  tags: {
    hook: string | null;
    angle: string | null;
    funnel: string | null;
    usp: string | null;
    persona: string | null;
    mediaUsed: boolean;
  } | null;
  perf: {
    spendCents: number;
    ctr: number;
    conversions: number;
    cpaCents: number | null;
  } | null;
  currencySymbol: string;
}

/**
 * Meta auto-names creatives by appending a date and a content hash
 * ("Headline 2026-02-18-7d48c408f53c…"). That suffix is provenance, not a
 * name — stripping it for DISPLAY (never for identity) is the difference
 * between a title and a database row leaking into the UI.
 */
function displayName(raw: string | null): string | null {
  if (!raw) return null;
  return (
    raw
      .replace(/\s*\d{4}-\d{2}-\d{2}(-[0-9a-f]{6,})?\s*$/i, "")
      .replace(/\s*[0-9a-f]{16,}\s*$/i, "")
      .trim() || raw
  );
}

const STATUS_DOT: Record<string, string> = {
  ACTIVE: "bg-success",
  IN_PROCESS: "bg-blue-500",
  WITH_ISSUES: "bg-warning",
  DELETED: "bg-subtle",
};

function money(cents: number, symbol: string): string {
  return `${symbol}${Math.round(cents / 100).toLocaleString()}`;
}

function PerfLine({ item }: { item: GalleryItem }) {
  if (!item.perf || item.perf.spendCents <= 0) {
    return <span className="text-[11px] text-subtle">never delivered</span>;
  }
  const p = item.perf;
  return (
    <span className="font-mono text-[11px] text-muted" style={{ fontFamily: "var(--font-mono)" }}>
      {money(p.spendCents, item.currencySymbol)} spent
      {p.cpaCents != null && <> · {money(p.cpaCents, item.currencySymbol)} CPA</>}
      {p.cpaCents == null && p.ctr > 0 && <> · {(p.ctr * 100).toFixed(2)}% CTR</>}
    </span>
  );
}

function TagChip({ label, tone = "paper" }: { label: string; tone?: "paper" | "ember" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
        tone === "ember"
          ? "bg-accent-subtle text-accent-hover"
          : "border border-border bg-surface text-muted",
      )}
    >
      {label}
    </span>
  );
}

export function CreativeGallery({ items }: { items: GalleryItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((i) => i.id === openId) ?? null;

  useEffect(() => {
    if (!open) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = orig;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setOpenId(c.id)}
            className="group overflow-hidden rounded-xl border border-border bg-surface text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift focus-visible:outline-accent"
          >
            {/* Media. Video creatives render the REAL mp4 (first frame as
                poster via #t, full resolution) and play muted on hover —
                Meta's video "thumbnails" are 160px and hotlink-blocked, so
                the source file is both the sharpest and the most reliable
                asset we hold. Images render the full-res original. */}
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-2">
              {c.isVideo && c.videoSourceUrl ? (
                <video
                  src={`${c.videoSourceUrl}#t=0.15`}
                  preload="metadata"
                  muted
                  playsInline
                  loop
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
                  onMouseLeave={(e) => {
                    e.currentTarget.pause();
                    e.currentTarget.currentTime = 0.15;
                  }}
                />
              ) : c.thumb ? (
                <Image
                  src={c.thumb}
                  alt={c.title ?? c.name ?? "Creative"}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1280px) 33vw, 25vw"
                  className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-subtle">
                  {c.isVideo ? <VideoIcon className="h-8 w-8" /> : <ImageIcon className="h-8 w-8" />}
                </div>
              )}
              {/* Hover scrim: performance surfaces where the eye already is */}
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 via-black/25 to-transparent p-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <span className="font-mono text-[11px] font-medium text-white/90" style={{ fontFamily: "var(--font-mono)" }}>
                  {c.perf && c.perf.spendCents > 0
                    ? `${money(c.perf.spendCents, c.currencySymbol)} spent`
                    : "never delivered"}
                </span>
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                  View
                </span>
              </div>
              {c.isVideo && (
                <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm">
                  <Play className="h-3 w-3 fill-current" />
                </span>
              )}
              {c.tags?.hook && (
                <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                  {c.tags.hook}
                </span>
              )}
            </div>

            {/* Meta */}
            <div className="space-y-1.5 p-3">
              <div className="flex items-center gap-1.5">
                {c.status && (
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[c.status] ?? "bg-subtle")} />
                )}
                <h3 className="line-clamp-1 text-[13px] font-medium" title={c.name ?? undefined}>
                  {displayName(c.name) ?? c.title ?? "Untitled creative"}
                </h3>
              </div>
              {c.body && <p className="line-clamp-2 text-xs leading-relaxed text-muted">{c.body}</p>}
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <PerfLine item={c} />
                {c.tags?.funnel && c.tags.funnel !== "unknown" && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-subtle">{c.tags.funnel}</span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Detail */}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
            onClick={() => setOpenId(null)}
          >
            <div
              className="rise-in flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-ink-border bg-background shadow-modal md:flex-row"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Media pane — the creative at honest size; videos actually play */}
              <div className="relative flex min-h-[220px] w-full items-center justify-center bg-ink md:w-[55%]">
                {open.isVideo && open.videoSourceUrl ? (
                  <video
                    src={open.videoSourceUrl}
                    controls
                    playsInline
                    className="max-h-[90vh] w-full object-contain"
                  />
                ) : open.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={open.thumb}
                    alt={open.title ?? "Creative"}
                    className="max-h-[90vh] w-full object-contain"
                  />
                ) : (
                  <ImageIcon className="h-12 w-12 text-ink-subtle" />
                )}
              </div>

              {/* Intelligence pane */}
              <div className="flex w-full flex-col overflow-y-auto md:w-[45%]">
                <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="min-w-0">
                    <h2
                      className="line-clamp-2 text-[15px] font-semibold"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      {displayName(open.name) ?? open.title ?? "Untitled creative"}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-subtle">{open.accountLabel}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenId(null)}
                    className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-4 px-4 py-4">
                  {/* Copy */}
                  {(open.title || open.body) && (
                    <section className="space-y-1.5">
                      {open.title && <p className="text-sm font-medium leading-snug">{open.title}</p>}
                      {open.body && <p className="whitespace-pre-line text-xs leading-relaxed text-muted">{open.body}</p>}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        {open.ctaLabel && <TagChip label={open.ctaLabel} tone="ember" />}
                        {open.linkUrl && (
                          <a
                            href={open.linkUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-muted underline-offset-2 hover:text-foreground hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {new URL(open.linkUrl).hostname}
                          </a>
                        )}
                      </div>
                    </section>
                  )}

                  {/* AI read */}
                  {open.tags && (
                    <section>
                      <h3 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                        <Sparkles className="h-3 w-3" /> AI read
                        <span className="ml-1 font-normal normal-case text-subtle">
                          {open.tags.mediaUsed ? "from copy + media" : "from copy only"}
                        </span>
                      </h3>
                      <div className="flex flex-wrap gap-1.5">
                        {open.tags.hook && <TagChip label={`Hook: ${open.tags.hook}`} />}
                        {open.tags.angle && <TagChip label={`Angle: ${open.tags.angle}`} />}
                        {open.tags.funnel && open.tags.funnel !== "unknown" && <TagChip label={open.tags.funnel} />}
                        {open.tags.persona && <TagChip label={`For: ${open.tags.persona}`} />}
                      </div>
                      {open.tags.usp && <p className="mt-1.5 text-xs italic text-muted">“{open.tags.usp}”</p>}
                    </section>
                  )}

                  {/* Performance */}
                  <section>
                    <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Performance · 90d</h3>
                    {open.perf && open.perf.spendCents > 0 ? (
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          ["Spend", money(open.perf.spendCents, open.currencySymbol)],
                          ["CPA", open.perf.cpaCents != null ? money(open.perf.cpaCents, open.currencySymbol) : "-"],
                          ["CTR", `${(open.perf.ctr * 100).toFixed(2)}%`],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-lg border border-border bg-surface px-2.5 py-2">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-subtle">{label}</div>
                            <div className="mt-0.5 text-sm font-semibold tabular-nums" style={{ fontFamily: "var(--font-display)" }}>
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-subtle">This creative has never delivered.</p>
                    )}
                  </section>

                  {/* Transcript */}
                  {open.transcript && (
                    <section>
                      <h3 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                        <ScrollText className="h-3 w-3" /> Transcript
                      </h3>
                      <p className="max-h-36 overflow-y-auto whitespace-pre-line rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
                        {open.transcript}
                      </p>
                    </section>
                  )}
                </div>

                <div className="mt-auto flex items-center justify-end border-t border-border px-4 py-2.5">
                  <DeleteButton
                    entityType="creative"
                    metaId={open.metaCreativeId}
                    name={displayName(open.name) ?? open.title ?? "this creative"}
                  />
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
