/**
 * Durable storage for Meta creative assets.
 *
 * WHY THIS EXISTS. Meta serves images and video posters from `fna.fbcdn.net`
 * edge appliances hosted inside ISP networks, and it rotates which one you
 * get. The hostnames it hands out do not merely expire, they are removed
 * from global DNS when the appliance is retired: three independent public
 * resolvers return no A record at all for a URL that was synced the previous
 * day. Measured lifetime on this account was about 24 hours, not the four
 * days the docs used to claim.
 *
 * That rules out proxying, because a proxy still replays a dead hostname.
 * The only moment these URLs reliably work is the instant Meta returns them
 * during a sync, so that is when the bytes get captured.
 *
 * DESIGN NOTES
 *
 * Content-addressed paths. An image is keyed by its Meta hash, which IS a
 * content fingerprint, so re-syncing the same asset overwrites identical
 * bytes. Cost is one download per asset ever, not one per sync.
 *
 * Fail-soft everywhere. `storeFromUrl` never throws. An asset sync that dies
 * because one thumbnail 404'd would be a far worse bug than a missing
 * thumbnail, so failures are reported in the return value and the caller
 * records the attempt for retry.
 *
 * Private bucket. These are client ad creatives. They are served through an
 * authenticated route rather than public URLs or signed links: the session
 * middleware already guards /api/*, and signing would add a round trip per
 * thumbnail in a forty-image gallery.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const ASSET_BUCKET = "meta-assets";

/** Refuse anything implausible for a creative asset. */
const MAX_BYTES = 64 * 1024 * 1024;

let cached: SupabaseClient | null = null;

/**
 * Storage client, or null when storage is not configured.
 *
 * Null rather than throwing: a deployment without storage credentials should
 * degrade to live Meta URLs, which is how the product worked before this
 * existed. Making it fatal would turn a missing optional env var into a
 * total outage of the sync.
 */
export function storageClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export function storageConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export type AssetKind = "images" | "videos" | "creatives";

/**
 * Path for an asset. Deterministic, so the same asset always lands in the
 * same place and a re-sync is idempotent.
 *
 * `key` is sanitised because it reaches a storage path: Meta ids and hashes
 * are hex or digits in practice, but a path traversal via a creative id is
 * not a thing worth being relaxed about.
 */
export function assetPath(
  kind: AssetKind,
  metaAdAccountId: string,
  key: string,
): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "_");
  return `${kind}/${safe(metaAdAccountId)}/${safe(key)}`;
}

export interface StoreResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  contentType?: string;
  /** Populated when ok is false. Short enough to log, never a whole page. */
  error?: string;
}

/**
 * Download from `url` and put the bytes in the bucket at `path`.
 *
 * Returns rather than throws. `skipIfPresent` avoids re-downloading an asset
 * already captured, which is what makes a routine sync cheap once the
 * backlog is done.
 */
export async function storeFromUrl(
  url: string,
  path: string,
  opts: { skipIfPresent?: boolean } = {},
): Promise<StoreResult> {
  const sb = storageClient();
  if (!sb) return { ok: false, error: "storage not configured" };

  try {
    if (opts.skipIfPresent) {
      const at = path.lastIndexOf("/");
      const dir = path.slice(0, at);
      const file = path.slice(at + 1);
      const { data } = await sb.storage.from(ASSET_BUCKET).list(dir, {
        search: file,
        limit: 1,
      });
      // `search` is a prefix match, so confirm the exact name before
      // concluding the asset is already there.
      if (data?.some((f) => f.name === file)) {
        return { ok: true, path, bytes: 0 };
      }
    }

    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return { ok: false, error: `source HTTP ${res.status}` };

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0) return { ok: false, error: "source returned 0 bytes" };
    if (buf.length > MAX_BYTES) {
      return { ok: false, error: `source too large (${buf.length} bytes)` };
    }

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const up = await sb.storage.from(ASSET_BUCKET).upload(path, buf, {
      contentType,
      upsert: true,
    });
    if (up.error) return { ok: false, error: up.error.message };

    return { ok: true, path, bytes: buf.length, contentType };
  } catch (e) {
    // Includes the DNS failures this module exists for: a retired edge
    // appliance surfaces here as a fetch TypeError, not an HTTP status.
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 200) };
  }
}

/** Stream one stored asset back. Null when it is not there. */
export async function readAsset(
  path: string,
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const sb = storageClient();
  if (!sb) return null;
  const { data, error } = await sb.storage.from(ASSET_BUCKET).download(path);
  if (error || !data) return null;
  return {
    body: await data.arrayBuffer(),
    contentType: data.type || "application/octet-stream",
  };
}

/**
 * Create the bucket if it is missing. Safe to call repeatedly.
 *
 * Private on purpose: an anonymous request for a path in a public bucket
 * succeeds, and these are client creatives.
 */
export async function ensureBucket(): Promise<{ ok: boolean; error?: string }> {
  const sb = storageClient();
  if (!sb) return { ok: false, error: "storage not configured" };
  const { data, error } = await sb.storage.listBuckets();
  if (error) return { ok: false, error: error.message };
  if (data.some((b) => b.name === ASSET_BUCKET)) return { ok: true };
  const mk = await sb.storage.createBucket(ASSET_BUCKET, { public: false });
  return mk.error ? { ok: false, error: mk.error.message } : { ok: true };
}
