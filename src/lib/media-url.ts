/**
 * Which URL should the UI actually render for an asset?
 *
 * Stored bytes win. Meta's own URL is the fallback, not the default, because
 * it stops resolving within about a day: the fna.fbcdn.net edge appliance is
 * retired and its hostname leaves global DNS entirely, so the browser gets a
 * failed lookup rather than a 403.
 *
 * Keeping the fallback matters during the migration. The bucket fills one
 * sync at a time, and an account whose assets have not been captured yet
 * should show whatever Meta still serves rather than going blank. Once
 * storagePath is populated the fallback stops being reached.
 *
 * Pure, so it is trivially testable and safe to call from a server
 * component in a tight loop.
 */

export interface StorableAsset {
  storagePath?: string | null;
  /** Meta's short-lived CDN URL. */
  url?: string | null;
  thumbnailUrl?: string | null;
}

/**
 * Returns a URL to render, or null when there is nothing to show.
 *
 * Null is a real answer and callers should handle it: it means the asset was
 * never captured AND Meta gave us no URL, so the honest UI is an explicit
 * "no preview available" rather than a broken image icon.
 */
export function mediaUrl(asset: StorableAsset | null | undefined): string | null {
  if (!asset) return null;
  if (asset.storagePath) return `/api/media/${asset.storagePath}`;
  return asset.url ?? asset.thumbnailUrl ?? null;
}

/**
 * True when the URL we are about to render is Meta's rather than ours, i.e.
 * likely to be dead. Lets a component show an honest caption instead of a
 * broken image, and lets a gallery report how much of a library is still
 * uncaptured.
 */
export function isEphemeral(asset: StorableAsset | null | undefined): boolean {
  if (!asset) return false;
  if (asset.storagePath) return false;
  return Boolean(asset.url ?? asset.thumbnailUrl);
}
