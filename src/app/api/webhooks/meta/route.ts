/**
 * GET  /api/webhooks/meta — Meta's one-time verification handshake.
 * POST /api/webhooks/meta — receives IG comment/message events.
 *
 * PUBLIC route (excluded in middleware.ts): auth is the X-Hub-Signature-256
 * HMAC over the raw body with META_APP_SECRET, not the session cookie.
 *
 * Flow per spec §4: verify → split echoes from inbound events → dedupe
 * inbound (unique AutomationEvent.eventId; P2002 = duplicate delivery,
 * skip) → 200 fast → process in after() so Meta gets its ack in
 * milliseconds. Echoes are reconciled via recordEcho (see echo.ts) rather
 * than orchestrated. Unknown IG accounts are logged and skipped without
 * erroring (Meta must keep considering this endpoint healthy).
 */

import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  parseMetaWebhook,
  verifyWebhookSignature,
  type IncomingWebhookEvent,
} from "@/lib/meta/webhooks";
import { orchestrateEvent } from "@/server/services/automation/orchestrate";
import { recordEcho } from "@/server/services/automation/echo";
import type { IncomingEvent } from "@/server/services/automation/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (
    mode === "subscribe" &&
    token &&
    token === process.env.META_WEBHOOK_VERIFY_TOKEN &&
    challenge
  ) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

function toIncomingEvent(e: IncomingWebhookEvent): IncomingEvent {
  return {
    eventId: e.eventId,
    platform: e.platform,
    type: e.type,
    igUserId: e.igUserId,
    fromIgsid: e.fromIgsid,
    fromUsername: e.fromUsername,
    text: e.text,
    commentId: e.commentId,
    mediaId: e.mediaId,
    occurredAt: e.occurredAt,
    raw: e.raw,
  };
}

export async function POST(req: Request) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.error("[webhook] META_APP_SECRET is not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // not ours to parse — still ack
  }

  const all = parseMetaWebhook(body);
  const parsed = all.filter((e) => !e.isEcho);
  const echoes = all.filter((e) => e.isEcho && e.type === "MESSAGE");
  const keys = [...new Set([...parsed, ...echoes].map((e) => `${e.platform}:${e.igUserId}`))];
  const accounts = keys.length
    ? await prisma.socialAccount.findMany({
        where: {
          OR: keys.map((k) => {
            const [platform, accountId] = k.split(":");
            return { platform, accountId };
          }),
        },
        select: { id: true, platform: true, accountId: true },
      })
    : [];
  const byKey = new Map(
    accounts.map((a) => [`${a.platform}:${a.accountId}`, a.id]),
  );

  const fresh: Array<{ e: IncomingWebhookEvent; eventDbId: string }> = [];
  for (const e of parsed) {
    const igAccountId = byKey.get(`${e.platform}:${e.igUserId}`);
    if (!igAccountId) {
      console.warn("[webhook] event for unknown account", e.platform, e.igUserId);
      continue;
    }
    try {
      const row = await prisma.automationEvent.create({
        data: {
          eventId: e.eventId,
          igAccountId,
          eventType: e.type,
          fromIgsid: e.fromIgsid,
          fromUsername: e.fromUsername,
          text: e.text,
          commentId: e.commentId,
          mediaId: e.mediaId,
          rawJson: (e.raw ?? {}) as object,
        },
      });
      fresh.push({ e, eventDbId: row.id });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") continue; // duplicate
      throw err;
    }
  }

  after(async () => {
    // Echoes are reconciled, not orchestrated: they are OUR outbound
    // messages coming back. One that we did not send means a human replied
    // from Meta's own apps, which hands the thread over.
    for (const e of echoes) {
      const igAccountId = byKey.get(`${e.platform}:${e.igUserId}`);
      if (!igAccountId) continue;
      try {
        await recordEcho(
          { metaMid: e.eventId, toIgsid: e.toIgsid, text: e.text },
          igAccountId,
        );
      } catch (err) {
        console.error("[webhook] echo reconcile failed for", e.eventId, err);
      }
    }

    for (const { e, eventDbId } of fresh) {
      try {
        await orchestrateEvent(toIncomingEvent(e), { eventDbId });
      } catch (err) {
        console.error("[webhook] orchestrate failed for", e.eventId, err);
      }
    }
  });

  return NextResponse.json({ ok: true, received: fresh.length });
}
