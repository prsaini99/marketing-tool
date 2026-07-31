/**
 * Meta webhook security + parsing for the Instagram and Page objects.
 *
 * Every POST to /api/webhooks/meta must pass X-Hub-Signature-256
 * verification (HMAC-SHA256 of the raw body with the app secret) before we
 * trust a single byte of the payload. Parsing is defensive: Meta has
 * shipped payload variants (id vs comment_id, media object vs media_id),
 * so every field read goes through a fallback.
 */

import { createHmac, timingSafeEqual } from "crypto";

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  const got = signatureHeader.slice("sha256=".length);
  if (got.length !== expected.length) return false;
  return timingSafeEqual(
    Buffer.from(got, "utf8"),
    Buffer.from(expected, "utf8"),
  );
}

export type WebhookEventType = "COMMENT" | "MESSAGE";

export type WebhookPlatform = "INSTAGRAM" | "FACEBOOK";

export interface IncomingWebhookEvent {
  eventId: string; // comment id or message mid — natural dedupe key
  platform: WebhookPlatform; // which surface this came from
  type: WebhookEventType;
  igUserId: string; // OUR account: IG user id, or Facebook Page id
  fromIgsid: string | null; // sender's platform-scoped id
  fromUsername: string | null;
  text: string;
  commentId: string | null;
  mediaId: string | null;
  occurredAt: Date;
  isEcho: boolean; // our own sends/comments reflected back — always drop
  raw: unknown;
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Meta is inconsistent about the unit of webhook timestamps: Messenger-style
 * entries send milliseconds, but generic Graph-object webhooks (which is
 * what Instagram comment/message entries technically are) have been
 * observed sending seconds instead. Treat both entry.time and the messaging
 * branch's m.timestamp as ambiguous.
 *
 * 1e12 ms is roughly September 2001, so any plausible real-world timestamp
 * expressed in milliseconds is already >= 1e12 — anything smaller can only
 * be seconds, and needs *1000. Getting this wrong is silent and severe: if
 * a seconds value is treated as ms, occurredAt lands in 1970, the 7-day
 * comment->DM window computes as ~55 years, and every comment->DM is
 * skipped window_expired_comment.
 */
function normalizeTimestampMs(t: number): number {
  return t < 1e12 ? t * 1000 : t;
}

/**
 * Parse a Meta webhook payload into engine events.
 *
 * Handles two objects:
 *  - `instagram` — comments arrive as changes[].field === "comments"
 *  - `page`      — comments arrive as changes[].field === "feed", which is a
 *                  much noisier field: it also fires for reactions, shares,
 *                  edits, hides and deletions. Only `item === "comment"` with
 *                  `verb === "add"` is a new comment worth answering.
 *
 * DMs are identical on both objects (entry.messaging).
 */
export function parseMetaWebhook(body: unknown): IncomingWebhookEvent[] {
  const events: IncomingWebhookEvent[] = [];
  const root = body as {
    object?: string;
    entry?: Array<{
      id?: string | number;
      time?: number;
      changes?: Array<{ field?: string; value?: Record<string, unknown> }>;
      messaging?: Array<Record<string, unknown>>;
    }>;
  };
  const platform: WebhookPlatform | null =
    root?.object === "instagram"
      ? "INSTAGRAM"
      : root?.object === "page"
        ? "FACEBOOK"
        : null;
  if (!platform || !Array.isArray(root.entry)) return events;

  for (const entry of root.entry) {
    const accountId = entry.id != null ? String(entry.id) : "";
    if (!accountId) continue;
    const occurredAt = entry.time
      ? new Date(normalizeTimestampMs(entry.time))
      : new Date();

    for (const change of entry.changes ?? []) {
      const v = (change.value ?? {}) as Record<string, unknown>;

      if (platform === "INSTAGRAM") {
        if (change.field !== "comments") continue;
        const commentId = asStr(v.id) ?? asStr(v.comment_id);
        if (!commentId) continue;
        const from = v.from as { id?: string | number; username?: string } | undefined;
        const media = v.media as { id?: string | number } | undefined;
        const fromId = from?.id != null ? String(from.id) : null;
        events.push({
          eventId: commentId,
          platform,
          type: "COMMENT",
          igUserId: accountId,
          fromIgsid: fromId,
          fromUsername: asStr(from?.username),
          text: asStr(v.text) ?? "",
          commentId,
          mediaId:
            (media?.id != null ? String(media.id) : null) ?? asStr(v.media_id),
          occurredAt,
          isEcho: fromId === accountId,
          raw: v,
        });
        continue;
      }

      // FACEBOOK: the `feed` field carries far more than comments.
      if (change.field !== "feed") continue;
      if (asStr(v.item) !== "comment") continue;
      // Only brand-new comments. `edit`/`edited` would make the bot re-reply
      // every time someone fixes a typo; `remove`/`hide` would have it reply
      // to something that no longer exists.
      if (asStr(v.verb) !== "add") continue;
      const commentId = asStr(v.comment_id);
      if (!commentId) continue;
      const from = v.from as { id?: string | number; name?: string } | undefined;
      const fromId = from?.id != null ? String(from.id) : null;
      events.push({
        eventId: commentId,
        platform,
        type: "COMMENT",
        igUserId: accountId,
        fromIgsid: fromId,
        fromUsername: asStr(from?.name),
        text: asStr(v.message) ?? "",
        commentId,
        // Facebook post id, form "{page-id}_{post-id}".
        mediaId: asStr(v.post_id),
        occurredAt,
        // A comment authored by the Page itself. Without this the bot
        // answers its own replies in a loop.
        isEcho: fromId === accountId,
        raw: v,
      });
    }

    // DM events arrive under entry.messaging on BOTH objects, same shape.
    for (const m of entry.messaging ?? []) {
      const msg = m.message as
        | { mid?: string; text?: string; is_echo?: boolean }
        | undefined;
      const sender = m.sender as { id?: string | number } | undefined;
      if (!msg?.mid) continue;
      const senderId = sender?.id != null ? String(sender.id) : null;
      events.push({
        eventId: msg.mid,
        platform,
        type: "MESSAGE",
        igUserId: accountId,
        fromIgsid: senderId,
        fromUsername: null,
        text: asStr(msg.text) ?? "",
        commentId: null,
        mediaId: null,
        occurredAt:
          typeof m.timestamp === "number"
            ? new Date(normalizeTimestampMs(m.timestamp))
            : occurredAt,
        isEcho: msg.is_echo === true || senderId === accountId,
        raw: m,
      });
    }
  }
  return events;
}
