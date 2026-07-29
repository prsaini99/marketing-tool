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

/** Subscribe this app to the account's comment + message webhooks. */
export async function subscribeWebhooks(
  connectionId: string,
  igUserId: string,
): Promise<void> {
  const { accessToken } = await getCredential(connectionId);
  await metaPostParams(`/${igUserId}/subscribed_apps`, accessToken, {
    subscribed_fields: "comments,messages",
  });
}

/** Read back the current webhook subscription (setup checklist). */
export async function getSubscriptionStatus(
  connectionId: string,
  igUserId: string,
): Promise<IgSubscriptionStatus> {
  const { accessToken } = await getCredential(connectionId);
  const resp = await metaGet<{
    data?: Array<{ subscribed_fields?: string }>;
  }>(`/${igUserId}/subscribed_apps`, accessToken);
  const fields = (resp.data?.[0]?.subscribed_fields ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    subscribed: fields.includes("comments") && fields.includes("messages"),
    fields,
  };
}

/** Public reply to a comment. No time window. Returns the new comment id. */
export async function replyToComment(
  connectionId: string,
  commentId: string,
  text: string,
): Promise<{ id: string }> {
  const { accessToken } = await getCredential(connectionId);
  return metaPostParams<{ id: string }>(`/${commentId}/replies`, accessToken, {
    message: text,
  });
}

async function sendMessage(
  connectionId: string,
  igUserId: string,
  recipient: Record<string, string>,
  text: string,
): Promise<IgSendResult> {
  const { accessToken } = await getCredential(connectionId);
  const resp = await metaPostJson<{
    recipient_id?: string;
    message_id?: string;
  }>(`/${igUserId}/messages`, accessToken, {
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
  igUserId: string,
  commentId: string,
  text: string,
): Promise<IgSendResult> {
  return sendMessage(connectionId, igUserId, { comment_id: commentId }, text);
}

/** DM to an existing thread (24h window from their last inbound message). */
export function sendDm(
  connectionId: string,
  igUserId: string,
  igsid: string,
  text: string,
): Promise<IgSendResult> {
  return sendMessage(connectionId, igUserId, { id: igsid }, text);
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
