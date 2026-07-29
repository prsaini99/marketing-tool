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

import { renderTemplate } from "./render";
import type { IncomingEvent, PlannedAction, RuleLike } from "./types";

export const MAX_DMS_PER_USER_PER_DAY = 5;
export const COMMENT_DM_WINDOW_DAYS = 7;
export const THREAD_DM_WINDOW_HOURS = 24;
export const HUMAN_FALLBACK_TEXT =
  "Thanks for reaching out! A teammate will get back to you shortly.";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DecideContext {
  event: IncomingEvent;
  matchedRule: RuleLike | null; // precomputed by the caller via matchRule
  aiFallbackEnabled: boolean;
  optedOut: boolean;
  lastInboundAt: Date | null;
  dmCountLast24h: number;
  alreadySentForRuleUser: boolean; // oncePerUser pre-check by the caller
  links: Record<string, string>;
  now: Date;
}

function skip(ruleId: string | null, reason: string): PlannedAction {
  return { action: "SKIPPED", ruleId, text: null, useAi: false, skipReason: reason };
}

function templateVars(event: IncomingEvent): Record<string, string> {
  return {
    username: event.fromUsername ?? "",
    comment_text: event.type === "COMMENT" ? event.text : "",
    message_text: event.type === "MESSAGE" ? event.text : "",
    // The webhook payload carries no caption; resolves empty until/unless a
    // caption fetch is added to the orchestrator.
    post_caption: "",
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
      const r = renderTemplate(rule.dmTemplate, templateVars(event), ctx.links);
      return { action: "DM_VIA_COMMENT", ruleId, text: r.text, useAi: false, skipReason: null };
    }
    if (rule?.aiFallback || !rule) {
      return { action: "AI_DM", ruleId, text: null, useAi: true, skipReason: null };
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
    const r = renderTemplate(rule.dmTemplate, templateVars(event), ctx.links);
    return { action: "DM", ruleId, text: r.text, useAi: false, skipReason: null };
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
    if (!ctx.aiFallbackEnabled) return [skip(null, "no_rule")];
    if (event.type === "COMMENT") {
      return [{ action: "AI_PUBLIC_REPLY", ruleId: null, text: null, useAi: true, skipReason: null }];
    }
    return [planDm(ctx, null)];
  }

  const actions: PlannedAction[] = [];

  if (rule.publicReplyEnabled) {
    if (rule.publicReplyTemplate.trim()) {
      const r = renderTemplate(rule.publicReplyTemplate, templateVars(event), ctx.links);
      actions.push({ action: "PUBLIC_REPLY", ruleId: rule.id, text: r.text, useAi: false, skipReason: null });
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
