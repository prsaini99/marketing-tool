/**
 * Instagram Graph + Messaging API — the organic IG surface (comments, DMs,
 * webhook subscriptions). Repo rule: only src/lib/meta/ calls Meta.
 *
 * Conventions match client.ts: getCredential per call, readMetaError
 * verbatim, MetaApiError on failure. The Messaging API takes nested JSON
 * bodies (recipient/message objects) so those sends POST application/json;
 * simple writes stay URL-encoded like the rest of client.ts.
 *
 * Meta windows enforced by the caller (services/automation/decide.ts):
 *  - DM via comment_id: ONE message only, within 7 days of the comment.
 *  - DM via igsid: within 24h of the user's last inbound message.
 */

import { getCredential } from "@/lib/meta/credentials";
import {
  metaGet,
  readMetaError,
  MetaApiError,
  META_API_VERSION,
} from "@/lib/meta/client";

const API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export interface IgDiscoveredAccount {
  igUserId: string;
  username: string;
  linkedPageId: string | null;
}

export interface IgMediaSummary {
  id: string;
  caption: string | null;
  mediaType: string;
  timestamp: string;
}

export interface IgSubscriptionStatus {
  subscribed: boolean;
  fields: string[];
}

export interface IgSendResult {
  recipientId: string | null;
  messageId: string | null;
}

export interface IgDebugToken {
  isValid: boolean;
  scopes: string[];
  expiresAt: Date | null;
}

/** POST with a JSON body (Messaging API). */
async function metaPostJson<T>(
  path: string,
  accessToken: string,
  body: unknown,
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const { message, code } = await readMetaError(res);
    throw new MetaApiError(message, res.status, code);
  }
  return res.json() as Promise<T>;
}

/** POST with URL-encoded params — the style every other write in client.ts uses. */
async function metaPostParams<T>(
  path: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) {
    const { message, code } = await readMetaError(res);
    throw new MetaApiError(message, res.status, code);
  }
  return res.json() as Promise<T>;
}

/**
 * Page access token cache, keyed `connectionId:pageId`.
 *
 * Why this exists: with the Facebook-Login flow (Business Manager system
 * user + a Page that has an IG professional account linked), the webhook
 * subscription and the messaging endpoints are **Page-scoped**, and Meta
 * rejects the system-user token on them with `#190 Invalid OAuth 2.0
 * Access Token`. The Page token is derived from the system-user token via
 * /me/accounts.
 *
 * Verified against the live Graph API (v23.0) on this app:
 *   GET  /{page-id}/subscribed_apps  + page token   -> 200
 *   GET  /{page-id}/subscribed_apps  + system token -> #190
 *   GET  /{ig-id}/subscribed_apps    + either       -> #100 nonexisting field
 *   POST /{page-id}/messages         + page token   -> reaches recipient validation
 *   POST /{ig-id}/messages           + either       -> #3 no capability
 *
 * Cached in memory (not persisted) so a rotated system-user token or a
 * permissions change is picked up on the next cold start rather than
 * needing an invalidation path. Page tokens derived from a never-expiring
 * system-user token do not themselves expire.
 */
const pageTokenCache = new Map<string, string>();

/**
 * Webhook fields to subscribe on the PAGE object.
 *
 * The Page object's field vocabulary differs from the Instagram object's:
 * `comments` is not valid here (Meta answers #100 with its full field list
 * and "got \"comments\""). Comment activity arrives under `feed`, and DMs
 * under `messages`. Confirmed against v23.0:
 *   POST /{page-id}/subscribed_apps?subscribed_fields=feed,messages -> {"success":true}
 *
 * Note this is the SUBSCRIPTION vocabulary only. Delivered payloads for an
 * IG-linked Page still arrive with `object: "instagram"` and the
 * `comments` / `messages` change fields that webhooks.ts parses — the two
 * naming schemes are independent.
 */
const PAGE_SUBSCRIBED_FIELDS = ["feed", "messages"] as const;

async function getPageAccessToken(
  connectionId: string,
  pageId: string,
): Promise<string> {
  const cacheKey = `${connectionId}:${pageId}`;
  const cached = pageTokenCache.get(cacheKey);
  if (cached) return cached;

  const { accessToken } = await getCredential(connectionId);
  const resp = await metaGet<{
    data?: Array<{ id: string; access_token?: string }>;
  }>("/me/accounts", accessToken, { fields: "id,access_token", limit: "100" });

  const page = (resp.data ?? []).find((p) => p.id === pageId);
  if (!page?.access_token) {
    throw new MetaApiError(
      `No Page access token available for Page ${pageId}. Assign the Page to this system user in Business Manager with full control, then regenerate the token.`,
      403,
    );
  }
  pageTokenCache.set(cacheKey, page.access_token);
  return page.access_token;
}

/**
 * List IG professional accounts reachable via the Pages this token can see
 * (system-user tokens: Pages assigned to the system user in BM). Pages
 * without a linked instagram_business_account are dropped.
 */
export async function discoverInstagramAccounts(
  connectionId: string,
): Promise<IgDiscoveredAccount[]> {
  const { accessToken } = await getCredential(connectionId);
  const resp = await metaGet<{
    data?: Array<{
      id: string;
      instagram_business_account?: { id: string; username?: string };
    }>;
  }>("/me/accounts", accessToken, {
    fields: "id,name,instagram_business_account{id,username}",
    limit: "100",
  });
  return (resp.data ?? [])
    .filter((p) => p.instagram_business_account?.id)
    .map((p) => ({
      igUserId: p.instagram_business_account!.id,
      username:
        p.instagram_business_account!.username ??
        p.instagram_business_account!.id,
      linkedPageId: p.id,
    }));
}

/** Recent media for the rule editor's media-targeting dropdown. */
export async function listRecentMedia(
  connectionId: string,
  igUserId: string,
  limit = 25,
): Promise<IgMediaSummary[]> {
  const { accessToken } = await getCredential(connectionId);
  const resp = await metaGet<{
    data?: Array<{
      id: string;
      caption?: string;
      media_type?: string;
      timestamp?: string;
    }>;
  }>(`/${igUserId}/media`, accessToken, {
    fields: "id,caption,media_type,timestamp",
    limit: String(limit),
  });
  return (resp.data ?? []).map((m) => ({
    id: m.id,
    caption: m.caption ?? null,
    mediaType: m.media_type ?? "UNKNOWN",
    timestamp: m.timestamp ?? "",
  }));
}

/**
 * Subscribe this app to the linked Page's comment + message webhooks.
 *
 * Page-scoped, with a Page token: `/{ig-id}/subscribed_apps` does not exist
 * (#100) and the system-user token is rejected here (#190). `pageId` is the
 * `linkedPageId` captured during discovery.
 */
export async function subscribeWebhooks(
  connectionId: string,
  pageId: string,
): Promise<void> {
  const pageToken = await getPageAccessToken(connectionId, pageId);
  await metaPostParams(`/${pageId}/subscribed_apps`, pageToken, {
    subscribed_fields: PAGE_SUBSCRIBED_FIELDS.join(","),
  });
}

/** Read back the current webhook subscription (setup checklist). */
export async function getSubscriptionStatus(
  connectionId: string,
  pageId: string,
): Promise<IgSubscriptionStatus> {
  const pageToken = await getPageAccessToken(connectionId, pageId);
  const resp = await metaGet<{
    data?: Array<{ subscribed_fields?: string | string[] }>;
  }>(`/${pageId}/subscribed_apps`, pageToken);
  // Meta returns subscribed_fields as a comma-joined string on some
  // responses and an array on others — normalize both.
  const raw = resp.data?.[0]?.subscribed_fields ?? [];
  const fields = (Array.isArray(raw) ? raw : raw.split(","))
    .map((s) => String(s).trim())
    .filter(Boolean);
  return {
    // Checked against the Page vocabulary we actually subscribe with
    // (feed + messages), not the Instagram-object names.
    subscribed: PAGE_SUBSCRIBED_FIELDS.every((f) => fields.includes(f)),
    fields,
  };
}

/**
 * Public reply to a comment. No time window. Returns the new comment id.
 * Comment-scoped, but written with the Page token like every other write
 * on this surface.
 */
export async function replyToComment(
  connectionId: string,
  pageId: string,
  commentId: string,
  text: string,
): Promise<{ id: string }> {
  const pageToken = await getPageAccessToken(connectionId, pageId);
  return metaPostParams<{ id: string }>(`/${commentId}/replies`, pageToken, {
    message: text,
  });
}

/**
 * Send an IG message via the linked Page. Page-scoped with a Page token:
 * `/{ig-id}/messages` returns #3 "Application does not have the capability
 * to make this API call" for both token types on the Facebook-Login flow.
 */
async function sendMessage(
  connectionId: string,
  pageId: string,
  recipient: Record<string, string>,
  text: string,
): Promise<IgSendResult> {
  const pageToken = await getPageAccessToken(connectionId, pageId);
  const resp = await metaPostJson<{
    recipient_id?: string;
    message_id?: string;
  }>(`/${pageId}/messages`, pageToken, {
    recipient,
    message: { text },
  });
  return {
    recipientId: resp.recipient_id ?? null,
    messageId: resp.message_id ?? null,
  };
}

/** ONE-shot private reply to a commenter (7-day window). */
export function sendDmToCommenter(
  connectionId: string,
  pageId: string,
  commentId: string,
  text: string,
): Promise<IgSendResult> {
  return sendMessage(connectionId, pageId, { comment_id: commentId }, text);
}

/** DM to an existing thread (24h window from their last inbound message). */
export function sendDm(
  connectionId: string,
  pageId: string,
  igsid: string,
  text: string,
): Promise<IgSendResult> {
  return sendMessage(connectionId, pageId, { id: igsid }, text);
}

/**
 * Inspect the connection's own token (app-scoped/system-user tokens can
 * debug themselves). Caller persists scopes onto Connection — lib/meta
 * does not write DB rows.
 */
export async function debugToken(
  connectionId: string,
): Promise<IgDebugToken> {
  const { accessToken } = await getCredential(connectionId);
  const resp = await metaGet<{
    data?: { is_valid?: boolean; scopes?: string[]; expires_at?: number };
  }>("/debug_token", accessToken, { input_token: accessToken });
  const d = resp.data ?? {};
  return {
    isValid: d.is_valid ?? false,
    scopes: d.scopes ?? [],
    expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null,
  };
}
