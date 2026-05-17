/**
 * Shared asset cards used wherever an ad's creative / image / video needs to
 * be rendered (ad detail page; future placement-preview screens).
 *
 * Two cards:
 *   • CreativeCard — name + headline + body + CTA + thumbnail + status
 *   • AssetCard    — image / video tile with thumbnail + id + extras
 *
 * Both fail soft: missing thumbnail → placeholder icon; missing metadata →
 * fields are simply omitted from the card.
 */

import Image from "next/image";
import { Image as ImageIcon, PlayCircle, Video as VideoIcon } from "lucide-react";

// Meta's call_to_action_type enum → readable labels. New ones get added as
// Meta expands; unknown values fall through to raw enum string.
export const CTA_LABEL: Record<string, string> = {
  SHOP_NOW: "Shop now",
  LEARN_MORE: "Learn more",
  SIGN_UP: "Sign up",
  BOOK_TRAVEL: "Book now",
  DOWNLOAD: "Download",
  GET_QUOTE: "Get quote",
  CONTACT_US: "Contact us",
  APPLY_NOW: "Apply now",
  SUBSCRIBE: "Subscribe",
  WATCH_MORE: "Watch more",
  GET_OFFER: "Get offer",
  ORDER_NOW: "Order now",
  INSTALL_APP: "Install app",
  USE_APP: "Use app",
  VIEW_INSTAGRAM_PROFILE: "View profile",
};

export function CreativeCard({
  name,
  title,
  body,
  ctaType,
  status,
  thumbnailUrl,
  metaCreativeId,
}: {
  name: string | null;
  title: string | null;
  body: string | null;
  ctaType: string | null;
  status: string | null;
  thumbnailUrl: string | null;
  metaCreativeId: string;
}) {
  const ctaLabel = ctaType ? (CTA_LABEL[ctaType] ?? ctaType) : null;
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="relative aspect-video w-full bg-surface-2">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt={title ?? name ?? "Creative"}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-subtle">
            <ImageIcon className="h-10 w-10" />
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
          Creative
        </span>
      </div>
      <div className="space-y-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <h4 className="line-clamp-1 text-sm font-medium text-foreground">
            {name ?? title ?? "Untitled creative"}
          </h4>
          {status && (
            <span className="shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted">
              {status}
            </span>
          )}
        </div>
        {title && title !== name && (
          <p className="line-clamp-1 text-xs font-medium text-foreground">
            {title}
          </p>
        )}
        {body && <p className="line-clamp-3 text-xs text-muted">{body}</p>}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {ctaLabel && (
            <span className="inline-flex items-center rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-foreground">
              {ctaLabel}
            </span>
          )}
          <span
            className="font-mono text-[10px] text-subtle"
            title={metaCreativeId}
          >
            {metaCreativeId}
          </span>
        </div>
      </div>
    </article>
  );
}

export function ImageAssetCard({
  name,
  hash,
  width,
  height,
  url,
}: {
  name: string | null;
  hash: string;
  width: number | null;
  height: number | null;
  url: string | null;
}) {
  const dims = width && height ? `${width} × ${height}` : null;
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="relative aspect-video w-full bg-surface-2">
        {url ? (
          <Image
            src={url}
            alt={name ?? hash}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-subtle">
            <ImageIcon className="h-10 w-10" />
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
          Image
        </span>
        {dims && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white">
            {dims}
          </span>
        )}
      </div>
      <div className="space-y-1 p-3">
        <h4 className="line-clamp-1 text-sm font-medium text-foreground">
          {name ?? "Untitled image"}
        </h4>
        <p className="font-mono text-[10px] text-subtle" title={hash}>
          Hash: {hash}
        </p>
      </div>
    </article>
  );
}

/**
 * Video tile. Two modes:
 *   • Fully mirrored — `sourceUrl` present → tile is clickable, plays in
 *     a new tab; length badge bottom-right.
 *   • Partial — Page-uploaded video Meta blocks our app from reading.
 *     We render thumbnail + id only and show a small "limited info" note.
 */
export function VideoAssetCard({
  title,
  videoId,
  thumbnailUrl,
  sourceUrl,
  lengthSeconds,
  partial,
}: {
  title: string | null;
  videoId: string;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
  lengthSeconds: number | null;
  // True when we couldn't pull the full video metadata (Page-uploaded
  // video); used to swap the hint and disable the play overlay.
  partial: boolean;
}) {
  const length = formatLength(lengthSeconds);
  const inner = (
    <div className="group relative aspect-video w-full bg-surface-2">
      {thumbnailUrl ? (
        <Image
          src={thumbnailUrl}
          alt={title ?? videoId}
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover"
          unoptimized
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-subtle">
          <VideoIcon className="h-10 w-10" />
        </div>
      )}
      <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
        Video
      </span>
      {!partial && sourceUrl && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
          <PlayCircle className="h-12 w-12 text-white opacity-80 drop-shadow" />
        </div>
      )}
      {length && (
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white">
          {length}
        </span>
      )}
    </div>
  );
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-background">
      {sourceUrl && !partial ? (
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
          {inner}
        </a>
      ) : (
        inner
      )}
      <div className="space-y-1 p-3">
        <h4 className="line-clamp-1 text-sm font-medium text-foreground">
          {title ?? "Untitled video"}
        </h4>
        <p className="font-mono text-[10px] text-subtle" title={videoId}>
          Video ID: {videoId}
        </p>
        {partial && (
          <p className="text-[11px] text-amber-700">
            Page-uploaded video — Meta only exposes the thumbnail and id to
            this app, not the source mp4 or length.
          </p>
        )}
      </div>
    </article>
  );
}

function formatLength(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
