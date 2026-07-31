/**
 * Rule matching. First match wins after filtering to enabled, event-type-
 * compatible, media-compatible rules sorted by ascending priority.
 *
 * Keyword match is WHOLE-WORD and case-insensitive — never substring.
 * Substring matching meant the keyword "AI" fired on "said", "again" and
 * "Airtel", DMing people who never asked for anything, which is how an
 * automation gets reported as spam. A commenter must actually say the word.
 *
 * "Whole word" is defined by the characters around the match rather than a
 * \b regex, because \b is ASCII-only: it would break on non-Latin scripts
 * (Hindi, Arabic) and on emoji-adjacent text, both of which are ordinary in
 * Instagram comments. A keyword may itself contain spaces or punctuation
 * ("book a demo", "price?"), so this compares boundaries, not tokens.
 */

import type { IncomingEvent, RuleLike } from "./types";

/**
 * True when `ch` can sit directly against a keyword without breaking the
 * "whole word" claim: anything that is not a letter, digit, or underscore.
 * Uses Unicode-aware classes so "AI" still matches inside Devanagari or
 * Arabic text, and so "AI!" / "(AI)" / "AI," all count.
 */
function isBoundaryChar(ch: string | undefined): boolean {
  if (ch === undefined) return true; // start or end of the text
  return !/[\p{L}\p{N}_]/u.test(ch);
}

/**
 * Whole-word, case-insensitive containment.
 *
 * Scans every occurrence rather than only the first: "saidAI things" must
 * not match on the embedded hit, but "said AI things" must still match on
 * the standalone one.
 */
export function containsKeyword(text: string, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return false;
  const haystack = text.toLowerCase();

  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? undefined : haystack[at - 1];
    const afterIdx = at + needle.length;
    const after = afterIdx >= haystack.length ? undefined : haystack[afterIdx];
    if (isBoundaryChar(before) && isBoundaryChar(after)) return true;
    from = at + 1;
  }
}

/**
 * Does this comment's media satisfy the rule's post scope?
 *
 * `adMediaIds` is the set of IG media ids currently running as ads, supplied
 * by the caller (the orchestrator syncs it). A comment whose media is in that
 * set came from an ad — including dark posts, which never appear in the
 * organic feed and so cannot be matched any other way.
 *
 * When the ad set is unavailable (empty), ADS and ORGANIC both fall back to
 * matching nothing and everything respectively, rather than guessing: a rule
 * that says "ads only" must not fire on organic posts just because the ad
 * list failed to load.
 */
export function mediaScopeMatches(
  rule: RuleLike,
  mediaId: string | null,
  adMediaIds: ReadonlySet<string>,
): boolean {
  switch (rule.mediaScope) {
    case "SPECIFIC":
      return Boolean(rule.mediaId) && rule.mediaId === mediaId;
    case "ADS":
      return Boolean(mediaId) && adMediaIds.has(mediaId!);
    case "ORGANIC":
      return Boolean(mediaId) && !adMediaIds.has(mediaId!);
    case "ALL":
    default:
      // Legacy rows predate mediaScope: a mediaId meant "only this post".
      return !rule.mediaId || rule.mediaId === mediaId;
  }
}

/**
 * Same matching as `matchRule`, but also reports whether the reason nothing
 * (higher-priority) matched was a negative-keyword veto rather than "no rule
 * was even relevant". Callers that treat "no rule matched" as license to run
 * an AI fallback need this distinction: a veto means "I have decided not to
 * speak", which must override the fallback, while a genuine no-match only
 * means "I have nothing scripted to say", which the fallback may answer.
 *
 * `vetoed` is true only when a rule was skipped for its negative keywords
 * AND no later (lower-priority) rule went on to match — a vetoed rule
 * "loses" to a real match by a catch-all exactly like today.
 */
export function matchRuleWithReason(
  event: IncomingEvent,
  rules: RuleLike[],
  adMediaIds: ReadonlySet<string> = new Set(),
): { rule: RuleLike | null; vetoed: boolean } {
  const text = event.text.toLowerCase();
  const candidates = rules
    .filter((r) => r.enabled)
    .filter((r) =>
      event.type === "COMMENT"
        ? r.triggerType.startsWith("COMMENT")
        : r.triggerType.startsWith("DM"),
    )
    // Post scoping applies to comment events; DMs have no media.
    .filter(
      (r) =>
        event.type === "MESSAGE" ||
        mediaScopeMatches(r, event.mediaId, adMediaIds),
    )
    .sort((a, b) => a.priority - b.priority);

  let vetoed = false;
  for (const rule of candidates) {
    // Would this rule have fired at all? A rule whose own trigger doesn't
    // match is simply not this message's rule — its negative keywords are
    // irrelevant and must NOT count as a veto, or an unrelated rule's word
    // list would suppress a genuine question the fallback should answer.
    // ("book a demo" rule listing "not interested" as a negative keyword
    // must not swallow "not interested in the ad, but do you ship to
    // Canada?" — that rule was never going to answer this message anyway.)
    const positiveMatch =
      rule.triggerType.endsWith("_ANY") ||
      rule.keywords.some((k) => containsKeyword(text, k));
    if (!positiveMatch) continue;

    // This rule WOULD have answered — but a negative keyword vetoes it.
    // Record that, and keep matching: a vetoed high-priority rule must not
    // stop a lower-priority rule from getting its chance.
    if (rule.negativeKeywords.some((k) => containsKeyword(text, k))) {
      vetoed = true;
      continue;
    }
    return { rule, vetoed: false };
  }
  return { rule: null, vetoed };
}

export function matchRule(
  event: IncomingEvent,
  rules: RuleLike[],
  adMediaIds: ReadonlySet<string> = new Set(),
): RuleLike | null {
  return matchRuleWithReason(event, rules, adMediaIds).rule;
}
