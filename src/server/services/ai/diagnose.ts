/**
 * One-click diagnosis — answer a fixed question about one account.
 *
 * Deliberately NOT built on the chat engine, despite answering the same kind
 * of question. `runChatTurn` requires a persisted ChatThread and writes a
 * ChatMessage per turn; a button that silently created a thread on every
 * click would fill the user's chat sidebar with one-line threads they never
 * opened. This is a stateless question with a stateless answer.
 *
 * It also skips the tool loop. The chat assistant discovers what data it
 * needs through tool calls, which is right when the question is unknown —
 * but these five questions are known in advance, and
 * `buildWeeklyReportContext` already assembles exactly the shape they need
 * in one pass. One completion instead of three-to-five round trips, and a
 * far more predictable latency for something sitting behind a button.
 *
 * That context builder anchors its window to the latest insights day rather
 * than to today, so a lagging sync produces "the 7 days to 5 June" instead
 * of a fabricated empty week — the answer stays truthful about which period
 * it describes.
 */

import { complete } from "@/lib/llm/chat";
import { HUMAN_STYLE_RULES } from "@/lib/llm/style";
import { buildWeeklyReportContext } from "./report-context";
import {
  buildDiagnosisPrompt,
  getQuestion,
  type DiagnosisQuestion,
} from "@/lib/diagnosis-questions";

const SYSTEM = [
  "You are a senior performance marketer reviewing a Meta ads account.",
  "You are blunt, specific and numerate. You name campaigns, not",
  "generalities. You never pad an answer to sound thorough, and you say",
  "when the data cannot support a conclusion.",
].join(" ") + "\n\n" + HUMAN_STYLE_RULES;

/**
 * Recursively rewrite every `*Cents` key into its major-unit equivalent,
 * dropping the `Cents` suffix so nothing downstream can mistake the unit.
 *
 * Generic rather than field-by-field on purpose: `ReportContext` gains
 * fields over time, and a hand-written mapping would silently leak the next
 * money field added to it back into the prompt in cents.
 */
function toDisplayUnits(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toDisplayUnits);
  if (value === null || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key.endsWith("Cents") && typeof v === "number") {
      const base = key.slice(0, -"Cents".length);
      out[base] = Math.round(v) / 100;
    } else {
      out[key] = toDisplayUnits(v);
    }
  }
  return out;
}

export interface DiagnosisResult {
  questionId: string;
  label: string;
  answer: string;
  /** The window the answer describes — may lag today if the sync does. */
  period: { from: string; to: string };
  accountName: string;
}

export async function diagnose(
  metaAdAccountId: string,
  questionId: string,
): Promise<DiagnosisResult> {
  const question: DiagnosisQuestion | null = getQuestion(questionId);
  if (!question) throw new Error(`Unknown question: ${questionId}`);

  const context = await buildWeeklyReportContext(metaAdAccountId);

  // Convert cents → major units BEFORE the model ever sees them.
  //
  // report-context.ts emits every money field in cents (spendCents,
  // revenueCents, cpcCents…). Handing those over raw and asking the model to
  // divide is how "₹10,925 spent" becomes "INR 10,92,541" in an answer a
  // client reads — a 100× overstatement, delivered confidently. An
  // instruction is a request; a transform is a guarantee, so the numbers are
  // fixed here rather than in the prompt.
  const display = toDisplayUnits(context) as Record<string, unknown>;

  const revenueTracked =
    context.totals.current.revenueCents > 0 ||
    context.totals.previous.revenueCents > 0;

  const answer = await complete(
    buildDiagnosisPrompt(question, JSON.stringify(display), {
      currency: context.account.currency,
      revenueTracked,
    }),
    {
      model: "gpt-4o",
      // Analysis, not copywriting — the same account and the same numbers
      // should not produce a different verdict on a second click.
      temperature: 0.2,
      maxTokens: 500,
      system: SYSTEM,
    },
  );

  return {
    questionId: question.id,
    label: question.label,
    answer: answer.trim(),
    period: context.periods.current,
    accountName: context.account.name,
  };
}
