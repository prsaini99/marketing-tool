/**
 * AI prompt construction + output safety filter. Pure module.
 *
 * The AI may ONLY know what's in the structured bot profile — the system
 * prompt contains exactly that and nothing else. The output filter is a
 * hard check (not prompt instructions): replies containing banned topics,
 * URLs not in the profile's link library, or prices absent from the
 * profile corpus are rejected by the caller.
 */

export interface ProfileCorpus {
  businessDescription: string;
  toneRules: string;
  bannedTopics: string[];
  links: Record<string, string>;
  faqs: Array<{ question: string; answer: string }>;
}

export function buildSystemPrompt(
  p: ProfileCorpus,
  languageMode: string,
): string {
  const faqBlock = p.faqs
    .map((f, i) => `${i + 1}. Q: ${f.question}\n   A: ${f.answer}`)
    .join("\n");
  const linkBlock = Object.entries(p.links)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return [
    "You are the Instagram assistant for the business described below. Answer the user's message or comment helpfully and briefly (max ~60 words), like a real social media manager.",
    `\nBusiness:\n${p.businessDescription || "(not provided)"}`,
    p.toneRules ? `\nTone rules:\n${p.toneRules}` : "",
    faqBlock ? `\nFAQs:\n${faqBlock}` : "",
    linkBlock
      ? `\nLinks you may share (never invent other URLs):\n${linkBlock}`
      : "\nNever include any URLs.",
    p.bannedTopics.length
      ? `\nNever discuss these topics: ${p.bannedTopics.join(", ")}.`
      : "",
    languageMode === "mirror"
      ? "\nReply in the same language the user used."
      : `\nReply in ${languageMode}.`,
    "\nRules: never invent prices, discounts, dates, or policies not listed above. If you don't know, say a teammate will follow up. Set escalate=true when the user needs a human (complaints, legal, refunds beyond the FAQs). confidence is 0..1 that your reply is accurate and on-brand.",
  ]
    .filter(Boolean)
    .join("\n");
}

const URL_RE = /https?:\/\/[^\s)]+/gi;
const PRICE_RE =
  /(?:[$₹€£]\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:usd|inr|rs|dollars?|rupees)\b)/gi;

export function isReplySafe(reply: string, p: ProfileCorpus): boolean {
  const lower = reply.toLowerCase();
  if (
    p.bannedTopics.some(
      (t) => t.trim() && lower.includes(t.trim().toLowerCase()),
    )
  ) {
    return false;
  }
  const urls = reply.match(URL_RE) ?? [];
  const allowed = new Set(Object.values(p.links));
  if (urls.some((u) => !allowed.has(u))) return false;

  // Prices must come from the profile corpus. Normalize whitespace on both
  // sides before comparing; this is a guardrail, not a parser.
  const corpus = [
    p.businessDescription,
    ...p.faqs.map((f) => `${f.question} ${f.answer}`),
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const prices = reply.match(PRICE_RE) ?? [];
  return prices.every((price) =>
    corpus.includes(price.replace(/\s+/g, " ").toLowerCase().trim()),
  );
}
