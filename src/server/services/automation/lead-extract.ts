/**
 * Lead fact extraction — one gpt-4o-mini call over the recent conversation.
 *
 * Fails OPEN like intent-guard: the caller catches, and a failure must never
 * block a reply. Qualification is an enhancement, not a gate on responding.
 *
 * Returns ONLY fields it is confident were actually stated. Omitting a field
 * means "not stated here", which mergeLead treats as "leave what we know
 * alone" — never as "erase it".
 */

import { completeJson } from "@/lib/llm/chat";
import type { LeadFields } from "./lead";

export interface ExtractLeadArgs {
  history: Array<{ role: string; text: string }>;
  userText: string;
}

const EXTRACT_SCHEMA = {
  name: "lead_fields",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: ["string", "null"] },
      email: { type: ["string", "null"] },
      phone: { type: ["string", "null"] },
      company: { type: ["string", "null"] },
      requirement: { type: ["string", "null"] },
      budget: { type: ["string", "null"] },
      timeline: { type: ["string", "null"] },
    },
    required: [
      "name",
      "email",
      "phone",
      "company",
      "requirement",
      "budget",
      "timeline",
    ],
  },
};

const SYSTEM = [
  "You extract sales-lead facts from a conversation between a customer and a business's assistant.",
  "",
  "Return null for any field the customer has NOT actually stated. Never guess, never infer from tone, and never carry over an example.",
  "Only use what the CUSTOMER said, and ignore anything the assistant said.",
  "",
  "- name: the person's own name.",
  "- email / phone: contact details they gave.",
  "- company: the organisation they represent.",
  "- requirement: what they want built or bought, in their words, one short phrase.",
  "- budget: any figure or range they gave, verbatim (e.g. \"5 lakh\", \"under $2k\").",
  "- timeline: when they need it (e.g. \"next month\", \"Q3\", \"ASAP\").",
].join("\n");

export async function extractLead(
  args: ExtractLeadArgs,
): Promise<Partial<LeadFields>> {
  // `history` ALREADY ends with this turn's inbound message: orchestrate
  // appends the USER row before extraction runs, so re-appending
  // `args.userText` here showed the newest message to the model twice — which
  // over-weights it and can read as the customer repeating themselves.
  //
  // ASYMMETRY, ON PURPOSE: generateAiReply in ./ai.ts still has the same
  // duplication. It is left alone because it shapes live customer-facing
  // replies; changing it deserves its own verification pass rather than
  // riding along with an extraction fix. `userText` stays on ExtractLeadArgs
  // so the two call sites keep a matching shape.
  const convo = args.history
    .map(
      (h) =>
        `${h.role === "BOT" || h.role === "HUMAN" || h.role === "assistant" ? "Assistant" : "Customer"}: ${h.text}`,
    )
    .join("\n");

  const out = await completeJson<Partial<LeadFields>>(
    convo,
    { model: "gpt-4o-mini", system: SYSTEM, maxTokens: 200, temperature: 0 },
    EXTRACT_SCHEMA,
  );
  return out ?? {};
}
