/**
 * Instagram + Facebook Page Graph/Messaging API — comments and DMs on both
 * platforms. Repo rule: only src/lib/meta/ calls Meta. Both platforms are
 * Page-scoped: IG automation rides the Page linked to the IG professional
 * account, and Facebook automation rides the Page directly, so the same
 * Page-token machinery (getPageAccessToken) and send helpers serve both.
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
  /** True when this media is an ad post rather than an organic feed post. */
  isAd?: boolean;
  /** Ad delivery status (ACTIVE, CAMPAIGN_PAUSED, ...) — ads only. */
  adStatus?: string | null;
  /** Ad name from Ads Manager — ads only, helps the operator recognise it. */
  adName?: string | null;
  permalink?: string | null;
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
 * under `messages`. Confirmed live against v23.0:
 *   POST /{page-id}/subscribed_apps?subscribed_fields=feed,messages -> {"success":true}
 *
 * `message_echoes` (added later, for echo reconciliation) is now verified
 * live the same way, against Page 932368496624251 on v23.0:
 *   POST /{page-id}/subscribed_apps
 *        ?subscribed_fields=feed,messages,message_echoes -> {"success":true}
 *   GET  /{page-id}/subscribed_apps
 *        -> subscribed_fields: ["feed","messages","message_echoes"]
 * Meta accepts it on the Page object; it is NOT rejected with #100.
 *
 * Blast radius if that ever changes: this constant feeds the ONE
 * `/{page-id}/subscribed_apps` POST that subscribeWebhooks makes, and that
 * call is Page-scoped for BOTH platforms — an Instagram professional
 * account and its linked Facebook Page are two SocialAccount rows sharing a
 * single `linkedPageId`, so they subscribe through the same request with
 * the same field list. A future Meta rejection of any field here therefore
 * breaks Subscribe for Instagram accounts too, not just Facebook Pages.
 * Diagnose a #100 "(#100) ... got \"...\"" from Subscribe by dropping the
 * offending field from this list, never by adding a second call.
 *
 * Note this is the SUBSCRIPTION vocabulary only, and it is per-platform:
 * a Facebook Page subscribes `feed` + `messages` + `message_echoes` (this
 * constant), while an Instagram professional account subscribes `comments`
 * + `messages` on the `instagram` object. Delivered payloads follow the
 * same split — Page webhooks arrive as `object: "page"` with
 * `feed`/`messages` change fields, Instagram webhooks arrive as
 * `object: "instagram"` with `comments`/`messages` change fields — and
 * webhooks.ts's parser handles both.
 *
 * `message_echoes` is REQUIRED here and is not implied by `messages`: per
 * Meta's Messenger Platform docs, for Page/Messenger conversations "a
 * notification is sent when your business has sent a message" only under
 * the separate `message_echoes` field — `messages` alone covers inbound
 * customer messages only. (Instagram Messaging is the opposite: IG echo
 * notifications are already included in the `messages` field subscription,
 * no separate field exists or is needed there.) Without this, no Facebook
 * Page ever receives an echo of its own outbound sends, so echo
 * reconciliation (services/automation/echo.ts) — and therefore automatic
 * handoff when a human replies to a Facebook Page conversation from Meta's
 * own apps — is silently inert for every Facebook Page connected before
 * this field was added. Existing connections must re-run Subscribe
 * (`POST /api/automation/accounts/[id]/subscribe`) to pick this up; it is
 * not retroactive.
 */
const PAGE_SUBSCRIBED_FIELDS = ["feed", "messages", "message_echoes"] as const;

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

export interface FbDiscoveredPage {
  pageId: string;
  name: string;
}

/**
 * Facebook Pages this token can manage.
 *
 * Same /me/accounts call Instagram discovery uses — every Page is a
 * candidate for automation whether or not it has an IG account linked.
 */
export async function discoverFacebookPages(
  connectionId: string,
): Promise<FbDiscoveredPage[]> {
  const { accessToken } = await getCredential(connectionId);
  const resp = await metaGet<{
    data?: Array<{ id: string; name?: string }>;
  }>("/me/accounts", accessToken, { fields: "id,name", limit: "100" });
  return (resp.data ?? []).map((p) => ({
    pageId: p.id,
    name: p.name ?? p.id,
  }));
}

/**
 * Caption cache for single media lookups, keyed `${platform}:${mediaId}`.
 * The platform prefix keeps the two id spaces from colliding — an Instagram
 * media id and a Facebook Page post id are drawn from different namespaces
 * but nothing stops them coinciding.
 *
 * Comment events carry a media id but no caption, and the AI needs to know
 * which post someone is replying to ("how much for this?" is unanswerable
 * without it). Captions are immutable in practice — an edit is rare and a
 * stale caption is harmless — so a successful lookup is cached for the
 * process lifetime to keep one Graph call off the hot path of every comment.
 * A genuinely absent caption is cached as `""` (not `null`) so it still
 * counts as a cache hit above.
 *
 * Failures are deliberately NOT cached (see the catch below) — a transient
 * Graph error must not poison the entry for the rest of the process
 * lifetime; the next comment on the same media just retries the fetch.
 */
const captionCache = new Map<string, string>();

/**
 * Fetch a single media's (or Page post's) caption for AI context. Returns
 * null when the media is unreadable — callers treat that as "no context
 * available" rather than an error, because a missing caption must never
 * block a reply.
 *
 * Platform-aware because the two surfaces are shaped differently: an
 * Instagram media id reads its text from the `caption` field with the
 * system-user token; a Facebook Page post id (form `{page-id}_{post-id}`)
 * reads it from `message` and requires the Page token, not the system-user
 * token (same #190 rejection as every other Page-scoped call in this file).
 */
export async function getMediaCaption(
  connectionId: string,
  mediaId: string,
  platform: "INSTAGRAM" | "FACEBOOK" = "INSTAGRAM",
  pageId?: string | null,
): Promise<string | null> {
  const cacheKey = `${platform}:${mediaId}`;
  const cached = captionCache.get(cacheKey);
  if (cached !== undefined) return cached || null;
  try {
    let text: string | undefined;
    if (platform === "FACEBOOK") {
      if (!pageId) return null;
      const pageToken = await getPageAccessToken(connectionId, pageId);
      const resp = await metaGet<{ id: string; message?: string }>(
        `/${mediaId}`,
        pageToken,
        { fields: "id,message" },
      );
      text = resp.message;
    } else {
      const { accessToken } = await getCredential(connectionId);
      const resp = await metaGet<{ id: string; caption?: string }>(
        `/${mediaId}`,
        accessToken,
        { fields: "id,caption" },
      );
      text = resp.caption;
    }
    const caption = text ?? "";
    captionCache.set(cacheKey, caption);
    return caption || null;
  } catch {
    // Deleted media, revoked permission, transient failure — reply without
    // post context this time, but do NOT cache the miss: unlike a genuinely
    // absent caption, a transient error deserves a retry on the next comment
    // rather than being poisoned for the process lifetime.
    return null;
  }
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
 * Instagram media ids that belong to ADS on this ad account.
 *
 * Why this exists: ad creatives are usually "dark posts" — they never appear
 * in /{ig-user-id}/media, so the organic media list cannot see them and a
 * rule cannot target them. Comments on ads DO arrive on the same comments
 * webhook, carrying `effective_instagram_media_id`, which is exactly the id
 * returned here. Matching that id is what lets a rule act on ad comments.
 *
 * Returns delivery status and ad name alongside the media id so the UI can
 * show which ads are live and rules can restrict to delivering ads.
 */
export async function listAdInstagramMedia(
  connectionId: string,
  metaAdAccountId: string,
  limit = 200,
): Promise<IgMediaSummary[]> {
  const { accessToken } = await getCredential(connectionId);
  const acctId = metaAdAccountId.startsWith("act_")
    ? metaAdAccountId
    : `act_${metaAdAccountId}`;
  const resp = await metaGet<{
    data?: Array<{
      id: string;
      name?: string;
      effective_status?: string;
      creative?: {
        effective_instagram_media_id?: string;
        instagram_permalink_url?: string;
        body?: string;
        title?: string;
      };
    }>;
  }>(`/${acctId}/ads`, accessToken, {
    fields:
      "id,name,effective_status,creative{effective_instagram_media_id,instagram_permalink_url,body,title}",
    limit: String(limit),
  });

  // Several ads can share one creative, and therefore one IG media id.
  // Dedupe on media id, preferring an ACTIVE ad so the status shown reflects
  // the most permissive ad currently delivering that post.
  const byMedia = new Map<string, IgMediaSummary>();
  for (const ad of resp.data ?? []) {
    const mediaId = ad.creative?.effective_instagram_media_id;
    if (!mediaId) continue;
    const existing = byMedia.get(mediaId);
    if (existing && existing.adStatus === "ACTIVE") continue;
    byMedia.set(mediaId, {
      id: mediaId,
      caption: ad.creative?.body ?? ad.creative?.title ?? null,
      mediaType: "AD",
      timestamp: "",
      isAd: true,
      adStatus: ad.effective_status ?? null,
      adName: ad.name ?? null,
      permalink: ad.creative?.instagram_permalink_url ?? null,
    });
  }
  return [...byMedia.values()];
}

/** Organic posts on a Facebook Page, for rule targeting. */
export async function listPagePosts(
  connectionId: string,
  pageId: string,
  limit = 25,
): Promise<IgMediaSummary[]> {
  const pageToken = await getPageAccessToken(connectionId, pageId);
  const resp = await metaGet<{
    data?: Array<{ id: string; message?: string; created_time?: string }>;
  }>(`/${pageId}/posts`, pageToken, {
    fields: "id,message,created_time",
    limit: String(limit),
  });
  return (resp.data ?? []).map((p) => ({
    id: p.id,
    caption: p.message ?? null,
    mediaType: "POST",
    timestamp: p.created_time ?? "",
  }));
}

/**
 * Facebook post ids that belong to ADS on this ad account.
 *
 * The Facebook analogue of listAdInstagramMedia: ad creatives expose
 * `effective_object_story_id` (form "{page-id}_{post-id}"), which is
 * exactly the `post_id` a `feed` comment webhook carries.
 */
export async function listAdFacebookPosts(
  connectionId: string,
  metaAdAccountId: string,
  limit = 200,
): Promise<IgMediaSummary[]> {
  const { accessToken } = await getCredential(connectionId);
  const acctId = metaAdAccountId.startsWith("act_")
    ? metaAdAccountId
    : `act_${metaAdAccountId}`;
  const resp = await metaGet<{
    data?: Array<{
      id: string;
      name?: string;
      effective_status?: string;
      creative?: { effective_object_story_id?: string; body?: string; title?: string };
    }>;
  }>(`/${acctId}/ads`, accessToken, {
    fields:
      "id,name,effective_status,creative{effective_object_story_id,body,title}",
    limit: String(limit),
  });

  const byPost = new Map<string, IgMediaSummary>();
  for (const ad of resp.data ?? []) {
    const postId = ad.creative?.effective_object_story_id;
    if (!postId) continue;
    const existing = byPost.get(postId);
    if (existing && existing.adStatus === "ACTIVE") continue;
    byPost.set(postId, {
      id: postId,
      caption: ad.creative?.body ?? ad.creative?.title ?? null,
      mediaType: "AD",
      timestamp: "",
      isAd: true,
      adStatus: ad.effective_status ?? null,
      adName: ad.name ?? null,
    });
  }
  return [...byPost.values()];
}

/**
 * Subscribe this app to the linked Page's comment + message + outbound
 * message-echo webhooks (PAGE_SUBSCRIBED_FIELDS).
 *
 * Idempotent: re-POSTing the same field list returns {"success":true}
 * again, so re-running Subscribe on an already-subscribed Page is safe and
 * is the supported way to pick up a newly added field.
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
    // Checked against the Page vocabulary we actually subscribe with —
    // PAGE_SUBSCRIBED_FIELDS (currently feed + messages + message_echoes),
    // not the Instagram-object names. Deliberately every field, not a
    // subset: this drives the "Webhooks on" / "Setup needed" badge, and a
    // Page missing message_echoes genuinely cannot hand a thread over when
    // a human replies from Business Suite, so "Setup needed" is the honest
    // answer until Subscribe is re-run.
    subscribed: PAGE_SUBSCRIBED_FIELDS.every((f) => fields.includes(f)),
    fields,
  };
}

/**
 * Public reply to a comment. No time window. Returns the new comment id.
 * Comment-scoped, but written with the Page token like every other write
 * on this surface.
 *
 * THE EDGE DIFFERS BY PLATFORM — do not "simplify" this back to one path:
 *   Instagram: POST /{ig-comment-id}/replies
 *   Facebook:  POST /{comment-id}/comments   ("comment replies" in Meta's
 *              reference; Facebook comment objects have no /replies edge)
 * Using /replies on a Facebook comment fails with error 100 subcode 33
 * ("Object with ID ... does not exist, cannot be loaded due to missing
 * permissions, or does not support this operation") — which reads like a
 * permissions problem and is really a wrong-endpoint problem. That cost a
 * silently failed reply to a real customer.
 */
export async function replyToComment(
  connectionId: string,
  pageId: string,
  commentId: string,
  text: string,
  platform: "INSTAGRAM" | "FACEBOOK",
): Promise<{ id: string }> {
  const pageToken = await getPageAccessToken(connectionId, pageId);
  const edge = platform === "FACEBOOK" ? "comments" : "replies";
  return metaPostParams<{ id: string }>(`/${commentId}/${edge}`, pageToken, {
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
  extra?: Record<string, unknown>,
): Promise<IgSendResult> {
  const pageToken = await getPageAccessToken(connectionId, pageId);
  const resp = await metaPostJson<{
    recipient_id?: string;
    message_id?: string;
  }>(`/${pageId}/messages`, pageToken, {
    recipient,
    message: { text },
    ...extra,
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
 * Human-agent-tagged DM (24h–7d window). Meta's Human Agent tag
 * (`messaging_type: "MESSAGE_TAG"`, `tag: "HUMAN_AGENT"`) extends the plain
 * 24-hour messaging window to 7 days, but ONLY for messages a human actually
 * composed — Meta has no technical way to verify who wrote the text it is
 * sent through App Review approval and after-the-fact audit, and it is an
 * attestation, not a checked fact. Misuse risks losing the tag or the app's
 * messaging access entirely.
 *
 * This is why the tag is not a parameter on `sendDm`: `sendDm` is called
 * from the bot's automated `Sender` in orchestrate.ts, and any parameter
 * there is a parameter an automated code path could eventually pass. This
 * function exists so the tag has exactly one call site
 * (`services/automation/inbox.ts`'s `sendHumanMessage`), which only runs
 * from an operator-initiated inbox action — never from `orchestrateEvent` or
 * anything the webhook pipeline can reach. Do not add a `tag` parameter to
 * `sendDm`, and do not call this function from anywhere the bot itself can
 * trigger.
 */
export function sendHumanAgentDm(
  connectionId: string,
  pageId: string,
  igsid: string,
  text: string,
): Promise<IgSendResult> {
  return sendMessage(connectionId, pageId, { id: igsid }, text, {
    messaging_type: "MESSAGE_TAG",
    tag: "HUMAN_AGENT",
  });
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
