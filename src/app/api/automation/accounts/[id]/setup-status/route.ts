/**
 * GET /api/automation/accounts/[id]/setup-status — live checklist data for
 * the setup page. Calls Meta (debug_token + subscribed_apps) so it's
 * fetched client-side, not server-rendered. Persists fresh scopes onto
 * Connection.scopes as a side effect (that field was a TODO placeholder).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { debugToken, getSubscriptionStatus } from "@/lib/meta/instagram";

// Module-private: Next route files may only export HTTP handlers + config.
const REQUIRED_SCOPES = [
  "instagram_basic",
  "instagram_manage_comments",
  "instagram_manage_messages",
  "pages_show_list",
  "pages_manage_metadata",
  "pages_read_engagement",
  "business_management",
];

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ig = await prisma.instagramAccount.findUnique({
    where: { id },
    select: {
      igUserId: true,
      linkedPageId: true,
      connectionId: true,
      webhookSubscribedAt: true,
    },
  });
  if (!ig) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let tokenValid = false;
  let scopes: string[] = [];
  let scopeError: string | null = null;
  try {
    const dbg = await debugToken(ig.connectionId);
    tokenValid = dbg.isValid;
    scopes = dbg.scopes;
    await prisma.connection.update({
      where: { id: ig.connectionId },
      data: { scopes },
    });
  } catch (e) {
    scopeError = msg(e);
  }

  let webhook = { subscribed: false, fields: [] as string[] };
  let webhookError: string | null = null;
  try {
    // Page-scoped: the IG-user-id edge does not exist (#100) and the
    // system-user token is rejected on Page edges (#190).
    if (!ig.linkedPageId) {
      throw new Error(
        "No linked Facebook Page recorded — re-run Discover to capture the Page linkage.",
      );
    }
    webhook = await getSubscriptionStatus(ig.connectionId, ig.linkedPageId);
  } catch (e) {
    webhookError = msg(e);
  }

  const origin = new URL(req.url).origin;
  return NextResponse.json({
    // Discovery via instagram_business_account implies a professional
    // account linked to a Page; pageLinked confirms the linkage is stored.
    professional: true,
    pageLinked: Boolean(ig.linkedPageId),
    tokenValid,
    scopes: {
      present: scopes,
      missing: REQUIRED_SCOPES.filter((s) => !scopes.includes(s)),
    },
    webhook: { ...webhook, subscribedAt: ig.webhookSubscribedAt },
    env: {
      appSecretSet: Boolean(process.env.META_APP_SECRET),
      verifyTokenSet: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
      verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? null,
      callbackUrl: `${origin}/api/webhooks/meta`,
    },
    errors: { scopeError, webhookError },
  });
}
