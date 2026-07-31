/**
 * POST /api/automation/accounts/[id]/rules — create a bot rule.
 * NOTE: Next.js route files may ONLY export HTTP handlers + route config —
 * helper functions stay module-private (no `export` keyword) or the build
 * fails with "not a valid Route export field".
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

const TRIGGER_TYPES = ["COMMENT_KEYWORD", "COMMENT_ANY", "DM_KEYWORD", "DM_ANY"];
const MEDIA_SCOPES = ["ALL", "ORGANIC", "ADS", "SPECIFIC"];

function parseRuleFields(body: Record<string, unknown>) {
  const triggerType =
    typeof body.triggerType === "string" && TRIGGER_TYPES.includes(body.triggerType)
      ? body.triggerType
      : null;
  const keywords = Array.isArray(body.keywords)
    ? (body.keywords as unknown[]).filter(
        (k): k is string => typeof k === "string" && k.trim().length > 0,
      )
    : [];
  if (!triggerType) return { error: "Invalid triggerType" } as const;
  if (triggerType.endsWith("KEYWORD") && keywords.length === 0) {
    return { error: "KEYWORD triggers need at least one keyword" } as const;
  }
  return {
    fields: {
      triggerType,
      keywords,
      negativeKeywords: Array.isArray(body.negativeKeywords)
        ? (body.negativeKeywords as unknown[]).filter(
            (k): k is string => typeof k === "string" && k.trim().length > 0,
          )
        : [],
      skipNoIntent: body.skipNoIntent === true,
      aiIntentGuard: body.aiIntentGuard === true,
      priority:
        typeof body.priority === "number" && Number.isInteger(body.priority)
          ? body.priority
          : 100,
      mediaScope:
        typeof body.mediaScope === "string" &&
        MEDIA_SCOPES.includes(body.mediaScope)
          ? body.mediaScope
          : "ALL",
      mediaId: typeof body.mediaId === "string" && body.mediaId ? body.mediaId : null,
      publicReplyEnabled: body.publicReplyEnabled === true,
      publicReplyTemplate:
        typeof body.publicReplyTemplate === "string" ? body.publicReplyTemplate : "",
      dmEnabled: body.dmEnabled === true,
      dmTemplate: typeof body.dmTemplate === "string" ? body.dmTemplate : "",
      aiFallback: body.aiFallback === true,
      aiInstructions:
        typeof body.aiInstructions === "string" ? body.aiInstructions : "",
      oncePerUser: body.oncePerUser !== false,
    },
  } as const;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = parseRuleFields(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const rule = await prisma.botRule.create({
    data: { igAccountId: id, ...parsed.fields },
  });
  return NextResponse.json({ rule });
}
