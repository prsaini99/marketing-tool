"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Play, RefreshCw, ScrollText, VideoOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeleteButton } from "@/components/common/delete-button";

/**
 * Video library grid + player.
 *
 * Two hard rules learned from this page's failures:
 *
 * 1. NEVER render Meta's video thumbnail URLs. They are t15 CDN assets that
 *    expire per-sync and hotlink-block in browsers — the "broken image
 *    icon + alt text" tiles this component replaced. The mp4 SOURCE is the
 *    only reliably-served video asset we hold, so tiles with a source render
 *    the video itself (first frame, hover-to-play) and tiles without one
 *    show a designed unavailable state, not an accidental one.
 *
 * 2. A dead card is worse than no card. Every tile opens the player modal:
 *    with a source it plays; without one it says exactly what's wrong and
 *    what fixes it (a videos re-sync refreshes the signed URLs).
 */

export interface VideoItem {
  id: string;
  metaVideoId: string;
  title: string | null;
  description: string | null;
  status: string | null;
  length: string | null;
  sourceUrl: string | null;
  /** Captured poster, served from our own storage. Stable, unlike Meta's. */
  posterUrl: string | null;
  transcript: string | null;
  accountLabel: string;
}

const STATUS_STYLE: Record<string, { pill: string; label: string }> = {
  ready: { pill: "bg-success-subtle text-success", label: "Ready" },
  processing: { pill: "bg-blue-50 text-blue-700", label: "Processing" },
  upload_complete: { pill: "bg-blue-50 text-blue-700", label: "Uploading" },
  error: { pill: "bg-warning-subtle text-warning", label: "Error" },
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const s = STATUS_STYLE[status] ?? {
    pill: "bg-surface-2 text-muted",
    label: status,
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        s.pill,
      )}
    >
      {s.label}
    </span>
  );
}

export function VideoGallery({ items }: { items: VideoItem[] }) {
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
        {items.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setOpenId(v.id)}
            className="group overflow-hidden rounded-xl border border-border bg-surface text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift"
          >
            <div className="relative aspect-video w-full overflow-hidden bg-surface-2">
              {v.sourceUrl ? (
                <>
                  <video
                    src={`${v.sourceUrl}#t=0.15`}
                    poster={v.posterUrl ?? undefined}
                    preload="metadata"
                    muted
                    playsInline
                    loop
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
                    onMouseLeave={(e) => {
                      e.currentTarget.pause();
                      e.currentTarget.currentTime = 0.15;
                    }}
                  />
                  <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm">
                    <Play className="h-3 w-3 fill-current" />
                  </span>
                </>
              ) : v.posterUrl ? (
                /* No downloadable source (Page-owned reels have none), but we
                   captured the poster, so show the frame rather than an
                   apology. */
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={v.posterUrl}
                    alt={v.title ?? "Video poster"}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm">
                    <Play className="h-3 w-3 fill-current" />
                  </span>
                </>
              ) : (
                /* Designed unavailable state — never a broken <img>. */
                <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-subtle">
                  <VideoOff className="h-7 w-7" />
                  <span className="text-[11px] font-medium">
                    Preview unavailable
                  </span>
                </div>
              )}
              {v.length && (
                <span
                  className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {v.length}
                </span>
              )}
            </div>

            <div className="space-y-1 p-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="line-clamp-1 text-[13px] font-medium" title={v.title ?? undefined}>
                  {v.title ?? "Untitled video"}
                </h3>
                <StatusPill status={v.status} />
              </div>
              {v.description && (
                <p className="line-clamp-2 text-xs leading-relaxed text-muted">{v.description}</p>
              )}
              <p className="text-[10px] text-subtle">{v.accountLabel}</p>
            </div>
          </button>
        ))}
      </div>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
            onClick={() => setOpenId(null)}
          >
            <div
              className="rise-in flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ink-border bg-background shadow-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2
                    className="line-clamp-1 text-[15px] font-semibold"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {open.title ?? "Untitled video"}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-subtle">
                    {open.accountLabel} ·{" "}
                    <span style={{ fontFamily: "var(--font-mono)" }}>{open.metaVideoId}</span>
                  </p>
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

              {open.sourceUrl ? (
                <div className="bg-ink">
                  <video
                    src={open.sourceUrl}
                    poster={open.posterUrl ?? undefined}
                    controls
                    autoPlay
                    playsInline
                    className="max-h-[55vh] w-full object-contain"
                  />
                </div>
              ) : (
                /* The honest error state: what's wrong, why, and the fix. */
                <div className="flex flex-col items-center gap-2 bg-ink px-6 py-12 text-center">
                  <VideoOff className="h-8 w-8 text-ink-subtle" />
                  <p className="text-sm font-medium text-ink-foreground">
                    This video&apos;s media isn&apos;t available right now
                  </p>
                  <p className="max-w-sm text-sm leading-relaxed text-ink-muted">
                    Two possible reasons. Meta&apos;s video links expire after a
                    few days, and{" "}
                    <span className="inline-flex items-center gap-1 font-medium text-ink-foreground">
                      <RefreshCw className="h-3.5 w-3.5" /> Sync now
                    </span>{" "}
                    fetches fresh ones. The second is a Page-owned video (a
                    boosted post or reel), for which Meta doesn&apos;t provide
                    a playable file to ads tools at all. If syncing
                    doesn&apos;t restore it, it&apos;s the second case: view it
                    on the Page or in Ads Manager.
                  </p>
                </div>
              )}

              <div className="space-y-3 overflow-y-auto px-4 py-3">
                {open.description && (
                  <p className="whitespace-pre-line text-xs leading-relaxed text-muted">
                    {open.description}
                  </p>
                )}
                {open.transcript && (
                  <section>
                    <h3 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <ScrollText className="h-3 w-3" /> Transcript
                    </h3>
                    <p className="max-h-32 overflow-y-auto whitespace-pre-line rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
                      {open.transcript}
                    </p>
                  </section>
                )}
              </div>

              <div className="mt-auto flex items-center justify-end border-t border-border px-4 py-2.5">
                <DeleteButton
                  entityType="video"
                  metaId={open.metaVideoId}
                  name={open.title ?? "this video"}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
