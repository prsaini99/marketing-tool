/**
 * No-intent filter — pure module, no imports, no I/O.
 *
 * Under an _ANY rule the engine will otherwise answer "🔥🔥🔥", "nice" and
 * even an empty string with a full DM. Someone dropping three fire emojis
 * has asked nothing; replying is spam.
 *
 * Deliberately NOT length-based: "How much?" is nine characters and is a
 * real question, "congratulations" is fifteen and is not. What the tokens
 * ARE decides, not how many characters they span.
 */

/**
 * Single words that carry no question and no stated interest. Only ever
 * applied when the message is NOTHING BUT one of these (plus emoji and
 * punctuation) — "nice, can you build this?" keeps its intent.
 *
 * Kept short and inspectable rather than exhaustive: the UI shows this list
 * so the behaviour is never mysterious. Multi-word praise ("great post")
 * is intentionally absent — that is the AI guard's job, not a list's.
 *
 * Affirmations ("yes", "no", "true", "real") must NOT be listed here: this
 * function is stateless and has no idea a DM_ANY rule may be mid-thread. A
 * user replying "yes" to the bot's own "Want the price list?" is real
 * intent, not filler — the engine keeps thread history precisely because
 * these are multi-turn conversations.
 */
const FILLER_WORDS = new Set([
  "nice", "wow", "ok", "okay", "cool", "lol", "lmao", "haha", "first",
  "hi", "hey", "hello", "yo", "great", "good", "amazing", "awesome",
  "love", "fire", "dope", "congrats", "congratulations", "thanks",
  "thank", "ty", "same", "facts",
]);

/**
 * Strip everything that carries no lexical meaning: emoji (including
 * multi-codepoint sequences with ZWJ and skin-tone modifiers), punctuation,
 * symbols, and whitespace. Unicode property escapes are used rather than an
 * ASCII range so Hindi, Arabic and other scripts survive — stripping them
 * would make every non-Latin comment look intentless.
 *
 * The variation selectors (U+FE0F, U+FE0E) and ZWJ (U+200D) must be in the
 * class EXPLICITLY. Without them "❤️" (a red heart) leaves the
 * invisible U+FE0F behind, that counts as a token, and a heart-only comment
 * looks like it has intent. Verified by execution, not assumed.
 *
 * `\p{Emoji}` must NEVER be in this class, even though it looks like the
 * obvious "match all emoji" property. Per UTS#51, `\p{Emoji}` also matches
 * plain ASCII digits 0-9 plus `#` and `*` — they're valid base characters
 * for keycap emoji sequences ("5" + U+FE0F + U+20E3). Verified by execution:
 * `/\p{Emoji}/u.test("5") === true`. Including it here strips digits before
 * counting tokens, so a digits-only message — e.g. a phone number,
 * "9876543210" — reduces to zero tokens and gets read as "no intent" and
 * silently suppressed. `\p{Emoji_Presentation}` + `\p{Extended_Pictographic}`
 * already cover every real emoji, and the explicit U+FE0F/U+FE0E/U+200D
 * below cover the variation-selector / ZWJ-sequence case ("heart + U+FE0F")
 * that motivated adding `\p{Emoji}` in the first place. DO NOT re-add
 * `\p{Emoji}`.
 */
function meaningfulTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(
      /[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\uFE0E\u200D]/gu,
      " ",
    )
    .replace(/[\p{P}\p{S}]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * True when the message says something worth answering.
 *
 * False for: empty/whitespace, emoji-only, and a single filler word.
 * True for everything else, including any multi-word message — erring
 * toward replying, because silently swallowing a real customer question is
 * worse than an unnecessary reply.
 */
export function hasIntent(text: string): boolean {
  const tokens = meaningfulTokens(text);
  if (tokens.length === 0) return false;
  if (tokens.length === 1 && FILLER_WORDS.has(tokens[0])) return false;
  return true;
}
