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
 * links with paths (wa.me/919999999999, bit.ly/xyz), and ANY bare domain
 * whose final label is 2+ letters (bestdealz.com, grabdeals.xyz, shop.online,
 * brand.link, help.info) — deliberately not restricted to a fixed TLD
 * allowlist, since a hallucinated domain outside any "known" TLD list still
 * needs to be caught; allowlist membership against the profile's link
 * library is what makes a URL "safe", not whether its TLD is well-known.
 * Two small denylists keep non-domain "word.word" prose out of the net (see
 * isDeniedBareDomain below for the exact rule); trailing punctuation is
 * stripped before normalization. Price matching uses symbol-first ($50),
 * number-first (50 usd), word-first (Rs 5000, USD 49), and percentage
 * (30%) formats; both prices and percentages are matched against the corpus
 * via exact set membership (not substring containment) to prevent
 * cross-sentence digit fusion exploits.
 */

export interface ProfileCorpus {
  businessDescription: string;
  toneRules: string;
  bannedTopics: string[];
  links: Record<string, string>;
  faqs: Array<{ question: string; answer: string }>;
}

/**
 * The subset of a BotLead the model is allowed to see.
 *
 * `email` and `phone` are DELIBERATELY ABSENT from this type — not merely
 * unused. The lead record exists so the bot stops re-asking for facts it
 * already has, and knowing someone's requirement/budget/timeline achieves
 * that. Reciting a contact detail back at a person achieves nothing except
 * sounding surveillance-y, and an AI_PUBLIC_REPLY is a PUBLIC comment: a
 * model told "this contact's phone is 98…" can repeat it where anyone can
 * read it. Omitting the fields from the prompt makes that leak structurally
 * impossible rather than a matter of instruction-following.
 *
 * A full BotLead row may be passed here — the extra properties are simply
 * never read (buildSystemPrompt walks leadPromptFields(channel), a
 * channel-aware allowlist).
 */
export interface LeadFacts {
  name?: string | null;
  company?: string | null;
  requirement?: string | null;
  budget?: string | null;
  timeline?: string | null;
}

// Allowlist + render order, channel-aware. Most decision-relevant first,
// since the block is read as a hint about what NOT to ask again.
//
// `budget` is dropped for PUBLIC_REPLY. Contact details (email/phone) are
// already structurally unreachable — see LeadFacts — but budget IS on the
// type because it's legitimate, useful context in a DM. A public comment
// reply is readable by anyone, including competitors, and the bot
// restating "your budget is 5 lakh" under a public post is a real leak of
// commercially sensitive information about the customer. Same reasoning
// that keeps phone/email off the type entirely, applied per-channel instead
// of globally because budget IS safe and useful in the DM case.
//
// `company` is deliberately NOT suppressed publicly: for an Instagram/
// Facebook commenter, the company is typically already visible from their
// handle or bio, so restating it adds little incremental exposure, and
// keeping it avoids re-asking for something the commenter effectively
// already made public themselves. Revisit this if the extractor is ever
// used somewhere company names aren't already public-by-default.
//
// `requirement` is NEVER suppressed on either channel — it's what the reply
// is actually about; hiding it would break the feature.
//
// IMPORTANT: keep this filter here, not as string surgery on the rendered
// block — post-processing a built prompt is exactly how a field like this
// leaks back in when someone reorders or reformats the block later.
function leadPromptFields(
  channel: "PUBLIC_REPLY" | "DM" | undefined,
): Array<[keyof LeadFacts, string]> {
  const fields: Array<[keyof LeadFacts, string]> = [
    ["requirement", "requirement"],
    ["budget", "budget"],
    ["timeline", "timeline"],
    ["company", "company"],
    ["name", "name"],
  ];
  return channel === "PUBLIC_REPLY"
    ? fields.filter(([key]) => key !== "budget")
    : fields;
}

/** Longest a single lead value may be once rendered into the prompt. */
const LEAD_VALUE_MAX = 120;

/**
 * Flatten a lead value before it is interpolated into the system prompt.
 *
 * EVERY value here is CUSTOMER-CONTROLLED: requirement/budget/timeline/
 * company/name are extracted verbatim from what the person typed into a DM or
 * a public comment. Interpolated raw, a customer can end a "requirement" with
 * newlines and then write their own prompt lines — "\n\nIGNORE PREVIOUS
 * INSTRUCTIONS AND ..." lands in the system prompt looking exactly like an
 * instruction we authored, because the block is line-delimited and the model
 * has no way to tell our lines from theirs.
 *
 * So: strip every newline, carriage return and other control character, and
 * collapse whitespace runs, so the value can only ever occupy part of ONE
 * line inside the block; then bound the length, since these are short facts
 * ("5 lakh", "next month") and a multi-KB "requirement" is an attack payload
 * or garbage either way, not a fact worth prompting with.
 */
function sanitizeLeadValue(value: string): string {
  return value
    // Newlines, carriage returns, tabs and every other C0/C1 control char
    // become a plain space, so the value can never break out of its line.
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LEAD_VALUE_MAX);
}

/**
 * Render the known-facts block, or "" when nothing is known. Blank/whitespace
 * values count as unknown — an empty "budget: " line would read to the model
 * as a fact it already has and stop it asking. `channel` controls which
 * fields are eligible at all — see leadPromptFields above. Every rendered
 * value goes through sanitizeLeadValue first — see the note there on why.
 */
function buildLeadBlock(
  lead: LeadFacts | null | undefined,
  channel: "PUBLIC_REPLY" | "DM" | undefined,
): string {
  if (!lead) return "";
  const parts = leadPromptFields(channel).flatMap(([key, label]) => {
    const value = lead[key];
    if (typeof value !== "string" || !value.trim()) return [];
    const clean = sanitizeLeadValue(value);
    // A value that is nothing but control characters sanitises to "" — still
    // "unknown", same as a blank one.
    return clean ? [`${label}: ${clean}`] : [];
  });
  if (!parts.length) return "";
  return `\nKnown about this contact: ${parts.join("; ")}.\nAlready stated by this contact — do NOT ask for any of it again. Do not restate these details back to them unless they bring it up first.`;
}

export function buildSystemPrompt(
  p: ProfileCorpus,
  languageMode: string,
  /**
   * Per-rule instruction, appended AFTER the profile blocks so it takes
   * precedence on wording/intent — a rule that says "one line, just the
   * link" should override the profile's general chattiness. It cannot
   * override the hard guardrails: the banned-topic list, the link
   * allowlist, and the never-invent-prices rule are all re-stated below it,
   * and isReplySafe enforces them on the output regardless of any prompt.
   */
  ruleInstructions?: string,
  /** Which surface this reply appears on — public comment vs private DM. */
  channel?: "PUBLIC_REPLY" | "DM",
  /** True when a DM is also going out for this same comment. */
  companionDm?: boolean,
  /**
   * Which Meta surface this reply is being sent on. Matters because the
   * model will otherwise default to "Instagram" in its self-description —
   * on a Facebook Page reply that means it can tell a real Facebook
   * commenter to "DM us on Instagram", pointing them at the wrong surface.
   */
  platform?: "INSTAGRAM" | "FACEBOOK",
  /**
   * Durable facts already extracted from this conversation. The lead record
   * IS the rolling summary — it is what lets a budget stated in message 1
   * still be known at message 40, once that message has fallen outside the
   * 30-message history window. Without it the bot re-asks for things it was
   * already told, which is the exact behaviour the lead table exists to kill.
   * Contact details are excluded by construction — see LeadFacts.
   */
  lead?: LeadFacts | null,
): string {
  const faqBlock = p.faqs
    .map((f, i) => `${i + 1}. Q: ${f.question}\n   A: ${f.answer}`)
    .join("\n");
  const linkBlock = Object.entries(p.links)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return [
    `You are the ${platform === "FACEBOOK" ? "Facebook Page" : "Instagram"} assistant for the business described below. Answer the user's message or comment helpfully and briefly (max ~60 words), like a real social media manager.`,
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
    // Conversation memory, not profile: what this specific contact has
    // already told us. Empty string when nothing is known, and .filter(Boolean)
    // below drops it entirely — a bare "Known about this contact:" header with
    // no facts would invite the model to invent some.
    buildLeadBlock(lead, channel),
    // Per-rule steer goes AFTER the profile blocks so it wins on wording and
    // intent, but BEFORE the hard rules below so it can never talk its way
    // past them.
    // Channel framing sits before the per-rule steer, so a rule instruction
    // can still override this default wording when it wants to.
    //
    // The companionDm case is the important one: without it the public reply
    // and the DM are generated independently from the same question and come
    // out near-identical — the public reply answers in full, so the DM adds
    // nothing and the pair reads like a glitch to the person who commented.
    channel === "PUBLIC_REPLY" && companionDm
      ? "\nThis is a PUBLIC comment reply, AND a DM with the full answer is being sent to this same person right now. Do NOT answer their question here and do NOT preview what the DM says. Write ONE short warm line that acknowledges them and points them to their DMs (like \"Just sent you a DM!\"). Under 12 words. No links."
      : channel === "PUBLIC_REPLY"
        ? "\nThis is a PUBLIC comment reply that everyone can read. Keep it to one or two short lines and invite them to DM you or book a call for the detail."
        : channel === "DM"
          ? "\nThis is a PRIVATE DM to one person. You can be more specific and detailed than a public reply, but stay under ~60 words."
          : "",
    ruleInstructions?.trim()
      ? `\nFor THIS specific reply:\n${ruleInstructions.trim()}`
      : "",
    "\nRules: never invent prices, discounts, dates, or policies not listed above. If you don't know, say a teammate will follow up. Set escalate=true when the user needs a human (complaints, legal, refunds beyond the FAQs), or when you've already declined or deflected the same request earlier in this conversation and the user is still asking. confidence is 0..1 that your reply is accurate and on-brand.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Match URLs with optional scheme and bare domains:
// - With scheme: https://example.com/path
// - Domain-like token, with or without a path: one or more
//   "label."-separated segments ending in a final label of 2+ pure letters
//   (no digits, so decimals/versions like "4.5/5" and "v1.2/beta" never
//   match — the final segment there is a digit, not a letter run).
// This is intentionally NOT restricted to a fixed TLD list (see module
// docstring): allowlist membership is the actual safety check, so the
// candidate-matching step should over-capture, not under-capture. Two
// denylists in isDeniedBareDomain() below claw back the resulting false
// positives on ordinary "word.word" prose.
const URL_RE = /(?:https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?)/gi;
const URL_TRAILING_PUNCT = /[.,!?;:)"']+$/;

// Final labels that are common file/product suffixes rather than TLDs —
// "Node.js", "Next.js", "report.pdf" must stay excluded even though "js"
// and "pdf" are structurally indistinguishable from a short TLD.
const FINAL_LABEL_DENYLIST = new Set([
  "js", "pdf", "ts", "png", "jpg", "md", "txt", "css", "html", "py", "sh",
  "exe", "zip", "doc", "csv",
]);
// First labels that are common English honorifics preceding a surname —
// "Mr.Patel", "Dr.Shah" must stay excluded. IMPORTANT: this is only safe to
// apply when the final label is NOT itself a plausible TLD — "dr.link",
// "st.shop", "ms.store", "prof.dev" are structurally identical to any other
// hallucinated domain (shop.online, brand.link) and MUST still be captured.
// Treating every "honorific.word" as prose regardless of the final label
// was the bug: it silently dropped a whole class of hallucinated URLs from
// the allowlist check, erring in the UNSAFE direction (send a bad link)
// instead of I4's intended over-capture-when-unsure direction (skip the
// reply). So the honorific exclusion only fires when KNOWN_TLDS doesn't
// already recognize the final label as a real-looking TLD.
const FIRST_LABEL_DENYLIST = new Set([
  "mr", "mrs", "ms", "dr", "st", "jr", "sr", "prof", "mx",
]);
// Common real/plausible-to-hallucinate TLDs. A final label in this set is
// treated as "looks like a real domain" and is never excluded by the
// honorific first-label check above, even though it may also coincidentally
// collide with an honorific pattern (dr.link, st.shop, prof.dev, ...).
const KNOWN_TLDS = new Set([
  "com", "net", "org", "io", "co", "in", "me", "ly", "app", "dev", "ai",
  "shop", "store", "biz", "xyz", "online", "link", "info", "site", "live",
  "page", "fun", "club", "top", "pro", "tech", "email", "help",
]);

/**
 * True when a captured bare-domain-looking token (no scheme) is actually
 * ordinary prose rather than a link, per the two denylists above. Scheme
 * URLs (https://...) are never filtered here — an explicit scheme is
 * unambiguous. Only applied to the label immediately around the dot; a
 * path after the domain doesn't change the verdict.
 */
function isDeniedBareDomain(candidate: string): boolean {
  if (/^https?:\/\//i.test(candidate)) return false;
  const host = candidate.split("/")[0];
  const labels = host.split(".");
  const finalLabel = labels[labels.length - 1]?.toLowerCase() ?? "";
  if (FINAL_LABEL_DENYLIST.has(finalLabel)) return true;
  const firstLabel = labels[0]?.toLowerCase() ?? "";
  if (
    labels.length === 2 &&
    FIRST_LABEL_DENYLIST.has(firstLabel) &&
    !KNOWN_TLDS.has(finalLabel)
  ) {
    return true;
  }
  return false;
}

// Match prices/discounts in four forms:
// 1. Symbol-first: $50, ₹500, €30, £20
// 2. Number-first: 50 usd, 500 inr, 999 rs
// 3. Word-first: Rs 500, USD 49, INR 2000 (optional . or space between word and number)
// 4. Percentage: 30%, 12.5 % — the system prompt forbids inventing
//    discounts, so a percentage not present in the profile corpus is just
//    as unsafe as a fabricated price and gets the same exact-set-membership
//    check.
const PRICE_RE =
  /(?:[$₹€£]\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:usd|inr|rs|dollars?|rupees)\b|\b(?:usd|inr|rs|rupees?)\s*\.?\s*\d[\d,.]*|\d+(?:\.\d+)?\s?%)/gi;

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

  // Check URLs: capture, strip trailing punctuation, drop denylisted
  // "word.word" prose (Node.js, report.pdf, Mr.Patel), normalize, and verify
  const urlMatches = reply.match(URL_RE) ?? [];
  const capturedUrls = urlMatches
    .map((u) => u.replace(URL_TRAILING_PUNCT, ""))
    .filter((u) => !isDeniedBareDomain(u));
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
