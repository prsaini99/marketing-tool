/**
 * POST /api/rules/[id]/preview
 *
 * Runs the rule against live metrics with `execute: false` — the same
 * evaluation the cron performs, with every action path unreachable. Answers
 * "what would this rule do right now?" before the operator ever enables it.
 *
 * The engine's dry-run safety is structural (no action function is called on
 * this path), not a convention this route has to remember, so a mistake here
 * cannot pause anything.
 */

import { NextResponse } from "next/server";
import { evaluateRuleById } from "@/server/services/rules/evaluate";

export const maxDuration = 120;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await evaluateRuleById(id, { execute: false });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Preview failed";
    return NextResponse.json(
      { error: message },
      { status: /not found/i.test(message) ? 404 : 500 },
    );
  }
}
