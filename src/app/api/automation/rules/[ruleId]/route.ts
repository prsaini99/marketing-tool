/**
 * PATCH  /api/automation/rules/[ruleId] — partial update (enabled toggle,
 * priority, templates, …). DELETE — remove the rule.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

const TRIGGER_TYPES = ["COMMENT_KEYWORD", "COMMENT_ANY", "DM_KEYWORD", "DM_ANY"];

const PATCHABLE = [
  "enabled",
  "priority",
  "triggerType",
  "keywords",
  "negativeKeywords",
  "skipNoIntent",
  "aiIntentGuard",
  "mediaScope",
  "mediaId",
  "publicReplyEnabled",
  "publicReplyTemplate",
  "dmEnabled",
  "dmTemplate",
  "aiFallback",
  "aiInstructions",
  "oncePerUser",
] as const;

const BOOLEAN_FIELDS = [
  "enabled",
  "publicReplyEnabled",
  "dmEnabled",
  "aiFallback",
  "oncePerUser",
  "skipNoIntent",
  "aiIntentGuard",
] as const;

const STRING_FIELDS = [
  "mediaScope",
  "dmTemplate",
  "publicReplyTemplate",
  "aiInstructions",
] as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ ruleId: string }> },
) {
  const { ruleId } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const data: Record<string, unknown> = {};
  for (const key of PATCHABLE) {
    if (key in body) data[key] = body[key];
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Type-validate every whitelisted field before it ever reaches Prisma.
  // Without this, a type mismatch (priority: "5", enabled: "true") throws
  // inside prisma.botRule.update, lands in the bare catch below, and comes
  // back as a misleading 404 "Rule not found" — indistinguishable from an
  // actually-missing rule.
  for (const key of BOOLEAN_FIELDS) {
    if (key in data && typeof data[key] !== "boolean") {
      return NextResponse.json({ error: `${key} must be a boolean` }, { status: 400 });
    }
  }
  if (
    "priority" in data &&
    (typeof data.priority !== "number" || !Number.isInteger(data.priority))
  ) {
    return NextResponse.json({ error: "priority must be an integer" }, { status: 400 });
  }
  for (const key of STRING_FIELDS) {
    if (key in data && typeof data[key] !== "string") {
      return NextResponse.json({ error: `${key} must be a string` }, { status: 400 });
    }
  }
  if (
    "mediaId" in data &&
    data.mediaId !== null &&
    typeof data.mediaId !== "string"
  ) {
    return NextResponse.json({ error: "mediaId must be a string or null" }, { status: 400 });
  }

  if (
    "triggerType" in data &&
    (typeof data.triggerType !== "string" || !TRIGGER_TYPES.includes(data.triggerType))
  ) {
    return NextResponse.json({ error: "Invalid triggerType" }, { status: 400 });
  }
  if ("keywords" in data) {
    if (!Array.isArray(data.keywords)) {
      return NextResponse.json({ error: "keywords must be an array" }, { status: 400 });
    }
    data.keywords = (data.keywords as unknown[]).filter(
      (k): k is string => typeof k === "string" && k.trim().length > 0,
    );
  }
  if ("negativeKeywords" in data) {
    if (!Array.isArray(data.negativeKeywords)) {
      return NextResponse.json(
        { error: "negativeKeywords must be an array" },
        { status: 400 },
      );
    }
    data.negativeKeywords = (data.negativeKeywords as unknown[]).filter(
      (k): k is string => typeof k === "string" && k.trim().length > 0,
    );
  }
  const existing = await prisma.botRule.findUnique({
    where: { id: ruleId },
    select: { triggerType: true, keywords: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
  const effectiveTriggerType =
    typeof data.triggerType === "string" ? data.triggerType : existing.triggerType;
  const effectiveKeywords = Array.isArray(data.keywords)
    ? (data.keywords as string[])
    : existing.keywords;
  if (effectiveTriggerType.endsWith("KEYWORD") && effectiveKeywords.length === 0) {
    return NextResponse.json(
      { error: "KEYWORD triggers need at least one keyword" },
      { status: 400 },
    );
  }
  try {
    await prisma.botRule.update({ where: { id: ruleId }, data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ ruleId: string }> },
) {
  const { ruleId } = await params;
  try {
    await prisma.botRule.delete({ where: { id: ruleId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
}
