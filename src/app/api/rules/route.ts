/**
 * GET  /api/rules?adAccountId=   — list rules for an account
 * POST /api/rules                — create a rule
 *
 * Money-metric thresholds cross the wire in MAJOR units (rupees, dollars)
 * because that is what the operator typed, and are stored in cents. Doing
 * that conversion here rather than in the client means there is exactly one
 * place to be wrong about it.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { RuleMetric, RuleScope } from "@/lib/ad-rules";

const SCOPES: RuleScope[] = ["campaign", "adset", "ad"];
const METRICS: RuleMetric[] = ["cpa", "spend", "roas", "ctr"];
const OPERATORS = ["gt", "lt"];
const ACTIONS = ["pause", "notify"];

/** cpa/spend are money (cents); roas/ctr are plain ratios. */
function isMoneyMetric(metric: string): boolean {
  return metric === "cpa" || metric === "spend";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const adAccountId = searchParams.get("adAccountId");
  if (!adAccountId) {
    return NextResponse.json({ error: "adAccountId is required" }, { status: 400 });
  }

  const rules = await prisma.adRule.findMany({
    where: { adAccountId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ rules });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const adAccountId = typeof body.adAccountId === "string" ? body.adAccountId : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const scope = String(body.scope ?? "");
  const metric = String(body.metric ?? "");
  const operator = String(body.operator ?? "");
  const action = String(body.action ?? "");

  if (!adAccountId) {
    return NextResponse.json({ error: "adAccountId is required" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!SCOPES.includes(scope as RuleScope)) {
    return NextResponse.json({ error: `scope must be one of ${SCOPES.join(", ")}` }, { status: 400 });
  }
  if (!METRICS.includes(metric as RuleMetric)) {
    return NextResponse.json({ error: `metric must be one of ${METRICS.join(", ")}` }, { status: 400 });
  }
  if (!OPERATORS.includes(operator)) {
    return NextResponse.json({ error: "operator must be gt or lt" }, { status: 400 });
  }
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "action must be pause or notify" }, { status: 400 });
  }

  const rawThreshold = Number(body.threshold);
  if (!Number.isFinite(rawThreshold) || rawThreshold <= 0) {
    return NextResponse.json({ error: "threshold must be a positive number" }, { status: 400 });
  }
  const threshold = isMoneyMetric(metric)
    ? Math.round(rawThreshold * 100)
    : rawThreshold;

  const windowDays = Number(body.windowDays);
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 30) {
    return NextResponse.json({ error: "windowDays must be 1-30" }, { status: 400 });
  }

  const rawMinSpend = Number(body.minSpend);
  // The spend floor is what stops a rule acting on statistical noise, so a
  // rule may not opt out of it entirely.
  if (!Number.isFinite(rawMinSpend) || rawMinSpend <= 0) {
    return NextResponse.json(
      { error: "minSpend must be a positive number, because a rule cannot act on zero spend" },
      { status: 400 },
    );
  }

  const cooldownHours = Number(body.cooldownHours ?? 24);
  if (!Number.isInteger(cooldownHours) || cooldownHours < 1 || cooldownHours > 720) {
    return NextResponse.json({ error: "cooldownHours must be 1-720" }, { status: 400 });
  }

  const entityIds = Array.isArray(body.entityIds)
    ? body.entityIds.filter((v): v is string => typeof v === "string" && Boolean(v))
    : [];

  const account = await prisma.metaAdAccount.findUnique({
    where: { id: adAccountId },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // New rules start DISABLED. A rule that begins acting the moment it is
  // saved gives the operator no chance to dry-run it first, and the whole
  // point of the preview is that it happens before anything is paused.
  const rule = await prisma.adRule.create({
    data: {
      adAccountId,
      name,
      enabled: false,
      scope,
      entityIds,
      metric,
      operator,
      threshold,
      windowDays,
      minSpendCents: Math.round(rawMinSpend * 100),
      action,
      cooldownHours,
    },
  });

  return NextResponse.json({ rule });
}
