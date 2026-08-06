/**
 * Deterministic repetition guard — pure module, no imports, no I/O.
 *
 * The AI reply model was asked (via the escalate rule in ai-guards.ts) to
 * notice when it's repeating itself, but that is exactly the failure mode
 * being guarded against: a model that has already deflected the same
 * question twice has no reliable self-awareness that turn three is the same
 * deflection again — each individual reply passes isReplySafe and the
 * confidence check in isolation, because each one IS a fine reply to the
 * message in front of it. What's missing is memory of the conversation
 * shape, not memory of any single message. A real observed failure: a
 * prospect asked three times to see example work, "client names" is a
 * banned topic, and the bot produced three near-identical, individually
 * reasonable-sounding deflections and never escalated. This module is the
 * deterministic backstop for that case — checked BEFORE a reply is sent,
 * not relied on as a prompt instruction.
 *
 * DELIBERATE BIAS TOWARD OVER-DETECTION. Read this before touching
 * SIMILARITY_THRESHOLD or the stopword list. The two failure directions are
 * not symmetric:
 *   - False positive: the guard fires on two replies that were actually
 *     fine. Cost = one unnecessary human handover. Mildly annoying,
 *     recoverable, invisible to the customer beyond "a person replies
 *     instead of the bot."
 *   - False negative: the guard misses a real loop. Cost = the exact bug
 *     this module exists to fix — the bot keeps stonewalling a real
 *     customer, verbatim-adjacent, with no human ever notified.
 * A false positive is cheap and a false negative is the incident. Tune
 * accordingly: when in doubt, lower the threshold / widen detection, not
 * the reverse. Do not "tighten" this after a complaint about an
 * over-eager handover without re-reading this comment.
 */

export const REPETITION_LOOKBACK = 3;

/**
 * A reply below this many CONTENT words (after stopword removal) is exempt
 * from the check entirely. Short replies ("Sure!", "Sent!", "Yes, here you
 * go.") trivially share most of their few content words with almost
 * anything and would otherwise produce constant false positives that drown
 * out real signal. This is not "recent replies were short" — it is a
 * structural floor: below a handful of content words there simply isn't
 * enough information for a similarity comparison to mean anything.
 */
const MIN_CONTENT_WORDS = 5;

/**
 * Two replies whose content-word Jaccard similarity is at or above this are
 * treated as repetitive. Chosen against real production data — the actual
 * three-message deflection loop this module exists to catch (thread igsid
 * 1743589263329499):
 *
 *   Reply 1: "We can't share specific client examples, but we work on
 *     projects like custom web and mobile apps, AI chatbots, cloud
 *     migrations, and data analytics solutions. If you have a project in
 *     mind, feel free to share, or book a call for more details!"
 *   Reply 2: "I understand! While we can't disclose specific client
 *     projects, we can discuss our approach and capabilities in detail
 *     during a discovery call. This way, you can get a clearer idea of how
 *     we can help with your needs. Would you like to book a call?"
 *   Reply 3: "I understand your interest, but we respect client
 *     confidentiality and can't share specific examples. However, we excel
 *     in areas like custom mobile apps, AI solutions, and cloud migrations.
 *     A discovery call can help us explore how we can assist you. Would you
 *     like to schedule one?"
 *
 * Measured content-word Jaccard: reply2 vs reply1 = 0.150, reply3 vs reply1
 * = 0.333, reply3 vs reply2 = 0.200. The weakest of the three real pairs
 * (reply2 vs reply1) sets the ceiling on how high the threshold can go.
 *
 * Negative control, same thread: the opening message ("Hi! We offer custom
 * software development, AI & machine learning, cloud services...") vs the
 * two LATER deflections scores 0.064 (vs reply2) and 0.098 (vs reply3) —
 * comfortably clear of every positive pair above. The opening message vs
 * reply1 itself scores 0.227: HIGHER than the reply2-vs-reply1 signal it
 * must stay under, because the opener and reply1 legitimately both list the
 * same service categories (custom/AI/cloud/data-analytics) — real,
 * non-coincidental shared vocabulary, not a rounding artifact. Content-word
 * Jaccard cannot tell "the same capability list stated twice, honestly" from
 * "the same refusal reworded" without semantics, and closing that gap is out
 * of reach for a dependency-free bag-of-words check. Given this module's
 * explicit bias toward over-detection (see the module doc comment), that
 * tradeoff is accepted deliberately: threshold is set at 0.15, low enough to
 * reliably catch the real deflection loop, which means a first AI reply that
 * happens to reuse several service-category nouns from an earlier message
 * CAN also trip the guard and hand off to a human early. That costs one
 * unnecessary handover; missing the actual loop costs a repeat of the
 * incident this module was written for. Do not raise this to "fix" an
 * occasional early handover without re-reading that tradeoff.
 */
export const SIMILARITY_THRESHOLD = 0.15;

/**
 * How many of the recent replies the candidate must resemble before it counts
 * as a loop. TWO, not one — and this is the load-bearing decision, more than
 * the threshold above.
 *
 * Measured on the real incident (thread igsid 1743589263329499):
 *
 *   deflection2 vs deflection1  0.150   <- must catch
 *   deflection3 vs deflection1  0.333   <- must catch
 *   deflection3 vs deflection2  0.200   <- must catch
 *   OPENER      vs deflection1  0.227   <- must NOT catch
 *
 * The opener scores HIGHER than a pair we need to catch, so no single
 * threshold can separate them: every reply about this business reuses the
 * same service vocabulary ("custom", "apps", "cloud", "AI"), and one-match
 * logic would flag the bot's SECOND reply in almost any conversation. That
 * isn't an occasional false handover — it stops the bot on turn two.
 *
 * Requiring two matches separates them cleanly on the same data:
 *   deflection1 -> 1 match (opener only)        -> sends, correctly
 *   deflection2 -> 1 match (deflection1)        -> sends, correctly
 *   deflection3 -> 2 matches (deflections 1,2)  -> BLOCKED, hands over
 *
 * Meaning: the bot gets to say something twice, but the third restatement of
 * the same point never reaches the customer. That is exactly the behaviour
 * the incident called for.
 */
const MIN_SIMILAR_PRIOR_REPLIES = 2;

/**
 * Small, deliberately generic English stopword list. Only function words —
 * articles, pronouns, auxiliaries, prepositions, conjunctions — are here.
 * Domain words ("client", "call", "examples", "discovery") MUST stay out:
 * they are exactly the content that makes two deflections the same
 * deflection. Without stopword removal, ordinary connective tissue like
 * "we can help you with that" would inflate the similarity of almost any
 * two replies in the same voice/tone, swamping the actual content-word
 * signal this check depends on.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "so", "to", "of", "in", "on",
  "at", "for", "with", "about", "as", "by", "from", "into", "like", "than",
  "that", "this", "these", "those", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "shall", "should", "can", "could", "may", "might", "must", "i", "you",
  "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my",
  "your", "his", "its", "our", "their", "not", "no", "yes", "up", "out",
  "over", "under", "again", "further", "then", "once", "here", "there",
  "all", "any", "both", "each", "few", "more", "most", "other", "some",
  "such", "only", "own", "same", "just", "want", "get", "give",
]);

/**
 * Lowercase, strip punctuation to spaces, split on whitespace, drop
 * stopwords and empty tokens. Deliberately simple (no stemming, no
 * lemmatisation) — this module imports nothing, so any normalisation has to
 * be hand-rolled, and word-set overlap is already discriminative enough for
 * the deflection-loop pattern this guards against (see threshold notes
 * above).
 */
function contentWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
  return new Set(words);
}

/** Jaccard similarity: |intersection| / |union|. Empty ∪ empty = 0, not NaN. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * True when `candidate` looks like a repeat of something the bot already
 * said, compared against the most recent `REPETITION_LOOKBACK` prior BOT
 * replies (caller is responsible for filtering the thread history down to
 * BOT-authored messages — see orchestrate.ts).
 *
 * Short-circuits (returns false) when the candidate doesn't clear
 * MIN_CONTENT_WORDS — see that constant's doc comment for why a short reply
 * cannot be meaningfully compared. Prior replies below the floor are simply
 * skipped as comparison targets rather than disqualifying the whole check.
 */
export function isRepetitive(
  candidate: string,
  priorBotReplies: string[],
): boolean {
  const candidateWords = contentWords(candidate);
  if (candidateWords.size < MIN_CONTENT_WORDS) return false;

  const recent = priorBotReplies.slice(-REPETITION_LOOKBACK);
  let similarCount = 0;
  for (const prior of recent) {
    const priorWords = contentWords(prior);
    if (priorWords.size < MIN_CONTENT_WORDS) continue;
    if (jaccard(candidateWords, priorWords) >= SIMILARITY_THRESHOLD) {
      similarCount += 1;
    }
  }
  // Two, not one — see MIN_SIMILAR_PRIOR_REPLIES for the measured reason a
  // single match cannot distinguish "saying it again" from "same business,
  // same vocabulary".
  return similarCount >= MIN_SIMILAR_PRIOR_REPLIES;
}
