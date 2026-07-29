/**
 * Opt-out detection. Any inbound DM that is essentially just "stop" marks
 * the thread opted out — compliance + spam protection.
 *
 * Two checks, either one opts the user out:
 *  (a) the whole (trimmed) message is just an opt-out keyword, optionally
 *      preceded by "please" — "stop", "please stop", "cancel!" etc.
 *  (b) the message is short (<= 6 words) and BEGINS with an opt-out
 *      keyword, optionally preceded by "please" — "stop sending me
 *      messages", "please unsubscribe me", "stop texting me".
 * The word-count cap on (b) is what keeps "don't stop the music" (doesn't
 * begin with the keyword) and "I couldn't stop laughing at your reel
 * yesterday" (too long, and doesn't begin with the keyword either) from
 * matching, while still catching short, clearly-intended opt-out phrasing
 * that isn't a bare keyword.
 */

const OPT_OUT_RE =
  /^\s*(please\s+)?(stop|unsubscribe|opt[\s-]?out|cancel|leave me alone)[\s!.]*$/i;

const OPT_OUT_KEYWORDS = [
  "stop",
  "unsubscribe",
  "opt out",
  "opt-out",
  "cancel",
  "leave me alone",
];

const SHORT_MESSAGE_MAX_WORDS = 6;

export function isOptOutMessage(text: string): boolean {
  const trimmed = text.trim();
  if (OPT_OUT_RE.test(trimmed)) return true;

  const normalized = trimmed.toLowerCase().replace(/^please\s+/, "");
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount === 0 || wordCount > SHORT_MESSAGE_MAX_WORDS) return false;

  return OPT_OUT_KEYWORDS.some((kw) => normalized.startsWith(kw));
}
