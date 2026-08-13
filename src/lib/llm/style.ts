/**
 * Shared writing-style rules appended to every prompt that produces prose a
 * human will read: ad copy, weekly reports, audits, anomaly explanations,
 * diagnoses, and the customer-facing automation replies.
 *
 * This is a plain string with no OpenAI import, so the pure automation
 * modules (ai-guards.ts) can use it without pulling in I/O.
 *
 * Why a prompt rule rather than a post-processing filter: "reads as
 * AI-generated" is a distribution of habits, not a token you can strip. A
 * regex can delete an em dash but it cannot un-write the parallel negation
 * that surrounded it. The one habit worth naming explicitly is the em dash,
 * because it is the single strongest tell and models reach for it constantly.
 */
export const HUMAN_STYLE_RULES = `Writing style (these override any habit to the contrary):
- Never use em dashes or en dashes. Use a comma, a full stop, or restructure the sentence.
- Avoid the patterns that make text read as machine-written: parallel negations ("Not X. Not Y."), three-item lists used for rhythm rather than because there are three things, "it's not just X, it's Y", opening with "Here's exactly what", and closing with a summarising flourish.
- Vary sentence length. Uniformly medium sentences are the clearest tell.
- Prefer the plain word: "use" over "utilise", "about" over "regarding", "so" over "thereby".
- Cut adjectives that carry no information: seamless, robust, powerful, comprehensive, cutting-edge.
- State the specific thing. A number, a name or a date beats a characterisation of one.`;

/**
 * One-line version for the customer-facing automation replies, which are
 * capped at roughly 60 words. The full block would cost more prompt budget
 * than the reply it governs, and most of its rules cannot even apply at
 * that length. The em dash rule is the part that still matters, because a
 * dash in a DM is what makes a person realise they are talking to a bot.
 */
export const HUMAN_STYLE_RULE_SHORT =
  "\nWrite the way a person types in a chat: short sentences, plain words, no em dashes or en dashes, no marketing adjectives.";
