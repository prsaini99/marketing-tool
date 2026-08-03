/**
 * Pure lead merge + stage derivation. No imports: no prisma, no network.
 *
 * This module is the reason Phase 1 needed no conversation summarizer. Facts
 * are promoted into fields the moment they are stated, so a budget mentioned
 * in message 1 survives the 30-message history window that would otherwise
 * have truncated it away.
 */

export type LeadStage = "NEW" | "ENGAGED" | "QUALIFIED" | "UNQUALIFIED";

export interface LeadFields {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  requirement: string | null;
  budget: string | null;
  timeline: string | null;
}

export const EMPTY_LEAD: LeadFields = {
  name: null,
  email: null,
  phone: null,
  company: null,
  requirement: null,
  budget: null,
  timeline: null,
};

const FIELD_KEYS = Object.keys(EMPTY_LEAD) as Array<keyof LeadFields>;

/**
 * Merge freshly extracted fields over what is already known.
 *
 * NEVER null-clobbers: a known value is only replaced by another non-empty
 * value, never erased. The extractor sees a truncated window of the
 * conversation, so "it didn't mention a budget this time" must not mean "there
 * is no budget" — that would delete the very fact this table exists to keep.
 */
export function mergeLead(
  existing: LeadFields | null,
  extracted: Partial<LeadFields>,
): LeadFields {
  const base: LeadFields = existing ? { ...existing } : { ...EMPTY_LEAD };
  for (const key of FIELD_KEYS) {
    const incoming = extracted[key];
    if (typeof incoming !== "string") continue;
    const trimmed = incoming.trim();
    if (!trimmed) continue; // empty string is "not stated", not "erase it"
    base[key] = trimmed;
  }
  return base;
}

/**
 * Derive the qualification stage from the facts on hand.
 *
 * UNQUALIFIED is deliberately sticky and never assigned here: only an operator
 * sets it. Letting the bot infer disinterest would silently write off leads,
 * which is far more costly than leaving one sitting at ENGAGED.
 */
export function deriveStage(
  lead: LeadFields,
  current?: LeadStage | null,
): LeadStage {
  if (current === "UNQUALIFIED") return "UNQUALIFIED";

  const hasContact = Boolean(lead.email || lead.phone);
  const hasTiming = Boolean(lead.budget || lead.timeline);
  if (lead.requirement && hasTiming && hasContact) return "QUALIFIED";

  const anyKnown = FIELD_KEYS.some((k) => Boolean(lead[k]));
  return anyKnown ? "ENGAGED" : "NEW";
}
