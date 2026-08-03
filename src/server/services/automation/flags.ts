/**
 * Pure: decides whether a thread should be flagged for human attention, and
 * why. No imports.
 *
 * Flagging never silences the bot — it only queues the thread for a person.
 * (Standing the bot down is Phase 3's ownership concept.)
 */

export type FlagReason = "ai_stuck" | "complaint" | "qualified";

export interface FlagInput {
  /** The reply model set escalate=true — it could not answer from the profile. */
  aiEscalated: boolean;
  /** Intent guard's category for this message, when the guard ran. */
  intentCategory: string | null;
  /** True only on the transition INTO QUALIFIED, not while already qualified. */
  becameQualified: boolean;
  /** Reason already on the thread, if any. */
  currentReason: FlagReason | null;
}

/**
 * Priority order: ai_stuck > complaint > qualified.
 *
 * A stuck bot and an angry customer are both live problems; a qualified lead
 * is an opportunity. If two apply at once the operator should see the problem.
 *
 * Returns null when nothing applies OR when the thread already carries a
 * reason — re-flagging on every subsequent message would keep resetting
 * flaggedAt and push an old, unattended thread to the top of the queue forever.
 *
 * PHASE 3 TRAP — read before building the Resolve action. `currentReason` is
 * the ONLY "already handled" signal this function has; it knows nothing about
 * `resolvedAt`. So a Resolve that stamps `resolvedAt` and leaves `flagReason`
 * set makes the thread permanently unflaggable: a thread resolved at
 * "qualified" that later gets an `ai_stuck` reply returns null here and the
 * escalation is silently dropped — the worst kind of failure, since nothing
 * surfaces anywhere. Resolve MUST null `flagReason` (and `flaggedAt`) as part
 * of the same update, or this function must start taking `resolvedAt` and
 * treating a resolved thread as having no current reason. Deliberately not
 * changed now: `resolvedAt` has no writer yet, so today the invariant holds.
 */
export function pickFlagReason(input: FlagInput): FlagReason | null {
  if (input.currentReason) return null;
  if (input.aiEscalated) return "ai_stuck";
  if (input.intentCategory === "COMPLAINT") return "complaint";
  if (input.becameQualified) return "qualified";
  return null;
}
