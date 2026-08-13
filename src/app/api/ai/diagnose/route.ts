/**
 * POST /api/ai/diagnose
 *
 * Body: { metaAdAccountId: string, questionId: string }
 *
 * Answers one of the fixed questions in src/lib/diagnosis-questions.ts about
 * one account. Read-only: one completion over an aggregate built from the
 * local mirror. Nothing is persisted — unlike the chat assistant, a click
 * here leaves no thread behind.
 *
 * `questionId` must be one of the known ids; free-form questions belong in
 * the chat assistant, which has the tool loop to go and find whatever they
 * need.
 */

import { NextResponse } from "next/server";
import { diagnose } from "@/server/services/ai/diagnose";

export const maxDuration = 120;

export async function POST(req: Request) {
  let body: { metaAdAccountId?: unknown; questionId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.metaAdAccountId !== "string" || !body.metaAdAccountId) {
    return NextResponse.json(
      { error: "metaAdAccountId is required" },
      { status: 400 },
    );
  }
  if (typeof body.questionId !== "string" || !body.questionId) {
    return NextResponse.json(
      { error: "questionId is required" },
      { status: 400 },
    );
  }

  try {
    const result = await diagnose(body.metaAdAccountId, body.questionId);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Diagnosis failed";
    const status = /unknown question|not found/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
