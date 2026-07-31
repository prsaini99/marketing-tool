/**
 * Decision engine — pure. Every guardrail input is injected via
 * DecideContext (the orchestrator does the DB reads), so the whole policy
 * is reviewable in one file and the dry-run route can exercise it with
 * zero side effects.
 *
 * Short-circuit order (spec §6):
 *   opted-out → no rule (→ AI fallback if enabled) → rule actions:
 *   per-action template-or-AI → once-per-user → window checks → daily cap.
 * A matched rule can fire BOTH a public reply and a DM — one PlannedAction
 * per attempted action.
 */

import { hasIntent } from "./intent";
import {
  INTENT_MIN_CONFIDENCE,
  INTENT_SKIP_REASONS,
  REPLYABLE,
  type IntentVerdict,
} from "./intent-guard";
import { renderTemplate } from "./render";
import type { ActionKind, IncomingEvent, PlannedAction, RuleLike } from "./types";

export const MAX_DMS_PER_USER_PER_DAY = 5;
export const MAX_PUBLIC_REPLIES_PER_USER_PER_DAY = 3;
export const COMMENT_DM_WINDOW_DAYS = 7;
export const THREAD_DM_WINDOW_HOURS = 24;
export const HUMAN_FALLBACK_TEXT =
  "Thanks for reaching out! A teammate will get back to you shortly.";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DecideContext {
  event: IncomingEvent;
  matchedRule: RuleLike | null; // precomputed by the caller via matchRule
  /**
   * True when the reason matchedRule is null is that a higher-priority rule
   * was vetoed by a negative keyword (see match.ts matchRuleWithReason), not
   * that no rule was relevant at all. Must block the AI fallback below: a
   * veto means "decided not to speak", which the fallback must never
   * override.
   */
  vetoedByNegativeKeyword?: boolean;
  aiFallbackEnabled: boolean;
  optedOut: boolean;
  lastInboundAt: Date | null;
  dmCountLast24h: number;
  alreadySentForRuleUser: boolean; // oncePerUser pre-check by the caller (DM actions only)
  publicReplyCountLast24h: number;
  alreadySentPublicForRuleUser: boolean; // oncePerUser pre-check for the public-reply action
  links: Record<string, string>;
  /**
   * Caption of the post being commented on, fetched by the orchestrator.
   * Feeds the {post_caption} template variable. Null for DM events and for
   * media we could not read.
   */
  postCaption?: string | null;
  /**
   * Verdict from the AI intent guard, when the matched rule enables it.
   * null means "not run, or the call failed" — both proceed to a reply.
   */
  intentVerdict?: IntentVerdict | null;
  now: Date;
}

function skip(ruleId: string | null, reason: string): PlannedAction {
  return { action: "SKIPPED", ruleId, text: null, useAi: false, skipReason: reason };
}

/**
 * A template can be non-empty yet render to nothing (e.g. "{message_text}"
 * on a comment event, or "{username}" with no username). Sending that would
 * put a blank DM or blank public comment in front of a real customer, so an
 * empty render is treated exactly like an empty template.
 */
function plannedFromRender(
  action: ActionKind,
  ruleId: string | null,
  rendered: string,
): PlannedAction {
  if (!rendered.trim()) return skip(ruleId, "empty_render");
  return { action, ruleId, text: rendered, useAi: false, skipReason: null };
}

function templateVars(
  event: IncomingEvent,
  postCaption?: string | null,
): Record<string, string> {
  return {
    username: event.fromUsername ?? "",
    comment_text: event.type === "COMMENT" ? event.text : "",
    message_text: event.type === "MESSAGE" ? event.text : "",
    // Fetched by the orchestrator from the media id on the event; empty for
    // DMs and for media we could not read.
    post_caption: postCaption ?? "",
  };
}

/** Guardrails shared by every DM action, then template-or-AI selection. */
function planDm(ctx: DecideContext, rule: RuleLike | null): PlannedAction {
  const { event } = ctx;
  const ruleId = rule?.id ?? null;

  if (ctx.dmCountLast24h >= MAX_DMS_PER_USER_PER_DAY) {
    return skip(ruleId, "daily_cap");
  }
  if (event.type === "COMMENT") {
    const ageMs = ctx.now.getTime() - event.occurredAt.getTime();
    if (ageMs > COMMENT_DM_WINDOW_DAYS * DAY_MS) {
      return skip(ruleId, "window_expired_comment");
    }
    if (rule && rule.dmTemplate.trim()) {
      const r = renderTemplate(rule.dmTemplate, templateVars(event, ctx.postCaption), ctx.links);
      return plannedFromRender("DM_VIA_COMMENT", ruleId, r.text);
    }
    if (rule?.aiFallback || !rule) {
      // AI changes what the text SAYS, never which channel it goes through.
      // A comment-triggered DM must still be sent as a private reply to the
      // comment (recipient: {comment_id}), which Meta allows under standard
      // access because the person commented first. Routing it as a thread DM
      // (recipient: {igsid}) is a cold DM and fails with
      // "#200 App does not have Advanced Access to instagram_manage_messages"
      // until App Review is granted.
      return {
        action: "AI_DM_VIA_COMMENT",
        ruleId,
        text: null,
        useAi: true,
        skipReason: null,
      };
    }
    return skip(ruleId, "empty_template");
  }

  // MESSAGE event: the orchestrator just stamped lastInboundAt=now for this
  // inbound DM, so the 24h check only fails for stale threads (defensive).
  const stale =
    !ctx.lastInboundAt ||
    ctx.now.getTime() - ctx.lastInboundAt.getTime() >
      THREAD_DM_WINDOW_HOURS * 60 * 60 * 1000;
  if (stale) return skip(ruleId, "window_expired");

  if (rule && rule.dmTemplate.trim()) {
    const r = renderTemplate(rule.dmTemplate, templateVars(event, ctx.postCaption), ctx.links);
    return plannedFromRender("DM", ruleId, r.text);
  }
  if (rule?.aiFallback || !rule) {
    return { action: "AI_DM", ruleId, text: null, useAi: true, skipReason: null };
  }
  return skip(ruleId, "empty_template");
}

export function decide(ctx: DecideContext): PlannedAction[] {
  const { event } = ctx;
  if (ctx.optedOut) return [skip(null, "opted_out")];

  const rule = ctx.matchedRule;
  if (!rule) {
    // A negative-keyword veto is a decision NOT to reply, not an absence of
    // a matching rule — it must override the AI fallback, or a rule like
    // keywords:["price"], negativeKeywords:["ripoff"] would have the AI
    // publicly answer "your price is a ripoff" the moment fallback is on.
    if (ctx.vetoedByNegativeKeyword) return [skip(null, "negative_keyword")];
    if (!ctx.aiFallbackEnabled) return [skip(null, "no_rule")];
    if (event.type === "COMMENT") {
      return [{ action: "AI_PUBLIC_REPLY", ruleId: null, text: null, useAi: true, skipReason: null }];
    }
    return [planDm(ctx, null)];
  }

  // Layer 2 — nothing worth answering was said. Checked after matching
  // because the toggle lives on the rule, and before any action is planned
  // so no template renders and no AI call is made.
  if (rule.skipNoIntent && !hasIntent(event.text)) {
    return [skip(rule.id, "no_intent")];
  }

  // Layer 3 — the classifier says this is not worth answering. Only a
  // confident verdict suppresses: an unsure classifier must not silently
  // swallow a real customer question, and a failed call (null) proceeds.
  const verdict = ctx.intentVerdict;
  if (
    rule.aiIntentGuard &&
    verdict &&
    verdict.confidence >= INTENT_MIN_CONFIDENCE &&
    !REPLYABLE.has(verdict.category)
  ) {
    return [skip(rule.id, INTENT_SKIP_REASONS[verdict.category])];
  }

  const actions: PlannedAction[] = [];

  // A public reply is only meaningful on a COMMENT event that actually has
  // a comment to reply to. A DM rule with publicReplyEnabled checked (or a
  // COMMENT event missing commentId, defensively) must not plan — and must
  // not log — a public-reply action at all: there is nothing to reply to,
  // and a SKIPPED row on every inbound DM would spam the activity log.
  if (rule.publicReplyEnabled && event.type === "COMMENT" && event.commentId) {
    if (rule.oncePerUser && ctx.alreadySentPublicForRuleUser) {
      actions.push(skip(rule.id, "once_per_user"));
    } else if (ctx.publicReplyCountLast24h >= MAX_PUBLIC_REPLIES_PER_USER_PER_DAY) {
      actions.push(skip(rule.id, "public_daily_cap"));
    } else if (rule.publicReplyTemplate.trim()) {
      const r = renderTemplate(rule.publicReplyTemplate, templateVars(event, ctx.postCaption), ctx.links);
      actions.push(plannedFromRender("PUBLIC_REPLY", rule.id, r.text));
    } else if (rule.aiFallback) {
      actions.push({ action: "AI_PUBLIC_REPLY", ruleId: rule.id, text: null, useAi: true, skipReason: null });
    } else {
      actions.push(skip(rule.id, "empty_template"));
    }
  }

  if (rule.dmEnabled) {
    if (rule.oncePerUser && ctx.alreadySentForRuleUser) {
      actions.push(skip(rule.id, "once_per_user"));
    } else {
      actions.push(planDm(ctx, rule));
    }
  }

  if (actions.length === 0) actions.push(skip(rule.id, "no_actions_enabled"));
  return actions;
}
