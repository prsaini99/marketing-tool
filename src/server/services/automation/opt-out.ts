/**
 * Opt-out detection. Any inbound DM that is essentially just "stop" marks
 * the thread opted out — compliance + spam protection. Anchored so
 * "don't stop the music" doesn't match; "please stop" does.
 */

const OPT_OUT_RE =
  /^\s*(please\s+)?(stop|unsubscribe|opt[\s-]?out|cancel|leave me alone)[\s!.]*$/i;

export function isOptOutMessage(text: string): boolean {
  return OPT_OUT_RE.test(text.trim());
}
