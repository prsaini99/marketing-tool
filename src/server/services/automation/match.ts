/**
 * Rule matching. First match wins after filtering to enabled, event-type-
 * compatible, media-compatible rules sorted by ascending priority.
 * Keyword match = case-insensitive substring on the event text.
 */

import type { IncomingEvent, RuleLike } from "./types";

export function matchRule(
  event: IncomingEvent,
  rules: RuleLike[],
): RuleLike | null {
  const text = event.text.toLowerCase();
  const candidates = rules
    .filter((r) => r.enabled)
    .filter((r) =>
      event.type === "COMMENT"
        ? r.triggerType.startsWith("COMMENT")
        : r.triggerType.startsWith("DM"),
    )
    // mediaId targeting applies to comment events; DMs have no media.
    .filter(
      (r) =>
        event.type === "MESSAGE" || !r.mediaId || r.mediaId === event.mediaId,
    )
    .sort((a, b) => a.priority - b.priority);

  for (const rule of candidates) {
    if (rule.triggerType.endsWith("_ANY")) return rule;
    if (
      rule.keywords.some(
        (k) => k.trim() && text.includes(k.trim().toLowerCase()),
      )
    ) {
      return rule;
    }
  }
  return null;
}
