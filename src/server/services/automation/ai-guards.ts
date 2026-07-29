/**
 * AI prompt construction + output safety filter. Pure module.
 *
 * The AI may ONLY know what's in the structured bot profile — the system
 * prompt contains exactly that and nothing else. The output filter is a
 * hard check (not prompt instructions): replies containing banned topics,
 * URLs not in the profile's link library, or prices absent from the
 * profile corpus are rejected by the caller.
 *
 * URL matching catches scheme-bound URLs (https://shop.biz/sale), bare-domain
 * links with paths (wa.me/919999999999, bit.ly/xyz), and bare domains ending
 * in recognized TLDs (bestdealz.com); trailing punctuation is stripped before
 * normalization. Price matching uses symbol-first ($50), number-first (50 usd),
 * and word-first (Rs 5000, USD 49) formats; prices are matched against the
 * corpus via exact set membership (not substring containment) to prevent
 * cross-sentence digit fusion exploits.
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

// Match URLs with optional scheme and bare domains:
// - With scheme: https://example.com/path
// - With path: domain.tld/path (e.g., wa.me/123, bit.ly/xyz)
// - Bare domain with allowed TLD (e.g., bestdealz.com, shop.biz)
// Bare domains without path require a recognized TLD to avoid false positives
// (e.g., "Node.js", "report.pdf", "Mr.Patel" are NOT links)
const URL_RE = /(?:https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z0-9-]+\/[^\s)]*|(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|in|me|ly|app|dev|ai|shop|store|biz)\b)/gi;
const URL_TRAILING_PUNCT = /[.,!?;:)"']+$/;

// Match prices in three forms:
// 1. Symbol-first: $50, ₹500, €30, £20
// 2. Number-first: 50 usd, 500 inr, 999 rs
// 3. Word-first: Rs 500, USD 49, INR 2000 (optional . or space between word and number)
const PRICE_RE =
  /(?:[$₹€£]\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:usd|inr|rs|dollars?|rupees)\b|\b(?:usd|inr|rs|rupees?)\s*\.?\s*\d[\d,.]*)/gi;

/**
 * Normalize a URL for comparison: lowercase, strip scheme, strip www.,
 * strip trailing / and trailing punctuation.
 */
function normalizeUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .replace(URL_TRAILING_PUNCT, "");
}

/**
 * Normalize a price for comparison: lowercase, strip spaces and commas
 * to handle formatting drift (e.g., "$1,200" vs "$1200").
 */
function normalizePrice(price: string): string {
  return price.toLowerCase().replace(/[\s,]/g, "");
}

export function isReplySafe(reply: string, p: ProfileCorpus): boolean {
  const lower = reply.toLowerCase();
  if (
    p.bannedTopics.some(
      (t) => t.trim() && lower.includes(t.trim().toLowerCase()),
    )
  ) {
    return false;
  }

  // Check URLs: capture, strip trailing punctuation, normalize, and verify
  const urlMatches = reply.match(URL_RE) ?? [];
  const capturedUrls = urlMatches.map((u) => u.replace(URL_TRAILING_PUNCT, ""));
  const normalizedAllowed = new Set(
    Object.values(p.links).map(normalizeUrl),
  );
  if (capturedUrls.some((u) => !normalizedAllowed.has(normalizeUrl(u)))) {
    return false;
  }

  // Check prices: extract allowed prices from corpus via PRICE_RE, build Set,
  // verify reply prices are in that Set (exact membership, not substring).
  // This prevents cross-sentence digit fusion exploits (e.g., "Rs 500 1 day"
  // becoming "rs5001" after raw delimiter stripping).
  const corpus = [
    p.businessDescription,
    ...p.faqs.map((f) => `${f.question} ${f.answer}`),
  ].join(" ");

  const allowedPriceMatches = corpus.match(PRICE_RE) ?? [];
  const allowedPrices = new Set(
    allowedPriceMatches.map(normalizePrice),
  );

  const replyPriceMatches = reply.match(PRICE_RE) ?? [];
  return replyPriceMatches.every((price) =>
    allowedPrices.has(normalizePrice(price)),
  );
}
