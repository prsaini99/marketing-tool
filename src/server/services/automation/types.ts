/**
 * Automation engine types. Pure module: relative imports only, no I/O.
 * The webhook route maps lib/meta/webhooks' IncomingWebhookEvent onto
 * IncomingEvent field-by-field (they intentionally don't share a type —
 * lib/meta must not depend on the service layer).
 */

export type AutomationEventType = "COMMENT" | "MESSAGE";

export interface IncomingEvent {
  eventId: string; // comment id or message mid
  /** Which surface this event came from — routes the account lookup. */
  platform: "INSTAGRAM" | "FACEBOOK";
  type: AutomationEventType;
  igUserId: string; // our account
  fromIgsid: string | null;
  fromUsername: string | null;
  text: string;
  commentId: string | null;
  mediaId: string | null;
  occurredAt: Date; // comment: used for the 7-day DM window check
  raw: unknown;
}

export type ActionKind =
  | "PUBLIC_REPLY"
  | "AI_PUBLIC_REPLY"
  | "DM"
  | "DM_VIA_COMMENT"
  | "AI_DM"
  | "AI_DM_VIA_COMMENT"
  | "SKIPPED";

export interface PlannedAction {
  action: ActionKind;
  ruleId: string | null;
  text: string | null; // rendered text; null when AI must generate (useAi)
  useAi: boolean;
  skipReason: string | null;
}

// Structural mirror of the Prisma BotRule — services pass rows straight in.
export interface RuleLike {
  id: string;
  enabled: boolean;
  priority: number;
  triggerType: string; // COMMENT_KEYWORD | COMMENT_ANY | DM_KEYWORD | DM_ANY
  keywords: string[];
  /** Words that veto this rule entirely — see match.ts. */
  negativeKeywords: string[];
  /** Skip emoji-only / single filler-word messages. */
  skipNoIntent: boolean;
  /** Run the AI intent+sentiment classifier before replying. */
  aiIntentGuard: boolean;
  /** ALL | ORGANIC | ADS | SPECIFIC — see BotRule.mediaScope. */
  mediaScope: string;
  mediaId: string | null;
  publicReplyEnabled: boolean;
  publicReplyTemplate: string;
  dmEnabled: boolean;
  dmTemplate: string;
  aiFallback: boolean;
  /** Per-rule steer appended to the profile system prompt. "" = profile only. */
  aiInstructions: string;
  oncePerUser: boolean;
}
