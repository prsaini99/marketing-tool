/**
 * Rule evaluation and execution.
 *
 * Reads each enabled rule, aggregates the window's metrics for every entity
 * in scope, asks the pure engine in `src/lib/ad-rules.ts` whether to act,
 * and — when it says yes — routes the action through the EXISTING bulk
 * services rather than calling Meta directly.
 *
 * That routing is the important architectural decision. `bulkChangeCampaignStatus`
 * and its siblings already write an AuditLog row before the Meta call and
 * stamp the outcome after (PROJECT.md rule #4). Calling `metaClient` from
 * here would be shorter and would silently create the codebase's first
 * unaudited write path — and it would be the one that runs unattended, which
 * is exactly the path that most needs a trace when someone asks "why is this
 * campaign paused?".
 *
 * DRY RUN is a first-class mode, not a debug flag, and it follows the
 * automation engine's structural-safety pattern: when `execute` is false, no
 * action function is ever invoked, so a preview cannot pause anything even
 * if a caller forgets to say so. The rules UI uses it to show "this rule
 * would pause 2 campaigns right now" before the operator ever enables it.
 */

import { prisma } from "@/lib/db/prisma";
import {
  evaluateRule,
  formatMetric,
  metricLabel,
  type Evaluation,
  type MetricsWindow,
  type RuleLike,
  type RuleMetric,
  type RuleOperator,
  type RuleScope,
} from "@/lib/ad-rules";
import { bulkChangeCampaignStatus } from "@/server/services/campaigns/bulk-status";
import { bulkChangeAdSetStatus } from "@/server/services/adsets/bulk-status";
import { bulkChangeAdStatus } from "@/server/services/ads/bulk-status";

export interface EntityEvaluation extends Evaluation {
  entityId: string;
  entityName: string;
  /** Present only when the rule fired AND execute was true. */
  actionStatus?: "ok" | "failed";
  actionError?: string;
}

export interface RuleRunResult {
  ruleId: string;
  ruleName: string;
  adAccountId: string;
  scope: RuleScope;
  entitiesEvaluated: number;
  fired: number;
  acted: number;
  failed: number;
  evaluations: EntityEvaluation[];
}

function currencySymbol(currency: string): string {
  if (currency === "INR") return "₹";
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  if (currency === "GBP") return "£";
  return "";
}

/** InsightsSnapshot.level values, keyed by rule scope. */
const SCOPE_TO_LEVEL: Record<RuleScope, string> = {
  campaign: "campaign",
  adset: "adset",
  ad: "ad",
};

/**
 * Sum each entity's insights across the window.
 *
 * `daysWithData` is counted per entity, not per account: one campaign can be
 * fully synced while another has a gap, and the pure engine's
 * insufficient-data guard is only meaningful if the count reflects the
 * entity it is judging.
 */
async function loadMetrics(
  adAccountId: string,
  scope: RuleScope,
  windowDays: number,
  entityIds: string[],
  now: Date,
): Promise<Map<string, MetricsWindow>> {
  // The window is measured from the CALLER's `now`, not from wall-clock
  // time. Reading the clock here would make the data window and the
  // cooldown check disagree whenever a caller passes an explicit `now`, and
  // would make evaluation impossible to reproduce — you could never re-run
  // "what did this rule see on Tuesday?" against the same rows.
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - windowDays);
  since.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.insightsSnapshot.findMany({
    where: {
      adAccountId,
      level: SCOPE_TO_LEVEL[scope],
      date: { gte: since },
      ...(entityIds.length > 0 ? { entityId: { in: entityIds } } : {}),
    },
    select: {
      entityId: true,
      date: true,
      spendCents: true,
      impressions: true,
      clicks: true,
      conversionsCount: true,
      revenueCents: true,
    },
  });

  const byEntity = new Map<string, MetricsWindow & { days: Set<string> }>();
  for (const r of rows) {
    const cur =
      byEntity.get(r.entityId) ??
      {
        spendCents: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenueCents: 0,
        daysWithData: 0,
        days: new Set<string>(),
      };
    cur.spendCents += r.spendCents;
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    cur.conversions += r.conversionsCount;
    cur.revenueCents += r.revenueCents;
    cur.days.add(r.date.toISOString().slice(0, 10));
    byEntity.set(r.entityId, cur);
  }

  const out = new Map<string, MetricsWindow>();
  for (const [id, v] of byEntity) {
    out.set(id, {
      spendCents: v.spendCents,
      impressions: v.impressions,
      clicks: v.clicks,
      conversions: v.conversions,
      revenueCents: v.revenueCents,
      daysWithData: v.days.size,
    });
  }
  return out;
}

/** Display names for the entities in scope, so results read as English. */
async function loadNames(
  adAccountId: string,
  scope: RuleScope,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  if (scope === "campaign") {
    const rows = await prisma.campaign.findMany({
      where: { adAccountId, metaCampaignId: { in: ids } },
      select: { metaCampaignId: true, name: true },
    });
    return new Map(rows.map((r) => [r.metaCampaignId, r.name]));
  }
  if (scope === "adset") {
    const rows = await prisma.adSet.findMany({
      where: { adAccountId, metaAdSetId: { in: ids } },
      select: { metaAdSetId: true, name: true },
    });
    return new Map(rows.map((r) => [r.metaAdSetId, r.name]));
  }
  const rows = await prisma.ad.findMany({
    where: { adAccountId, metaAdId: { in: ids } },
    select: { metaAdId: true, name: true },
  });
  return new Map(rows.map((r) => [r.metaAdId, r.name]));
}

/**
 * Pause one entity through the existing bulk service for its level, so the
 * audit-first contract and the local mirror update both come for free.
 */
async function pauseEntity(
  scope: RuleScope,
  metaId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (scope === "campaign") {
      const r = await bulkChangeCampaignStatus({
        action: "pause",
        metaCampaignIds: [metaId],
      });
      const item = r.items[0];
      return item?.status === "ok"
        ? { ok: true }
        : { ok: false, error: item?.reason ?? "unknown failure" };
    }
    if (scope === "adset") {
      const r = await bulkChangeAdSetStatus({
        action: "pause",
        metaAdSetIds: [metaId],
      });
      const item = r.items[0];
      return item?.status === "ok"
        ? { ok: true }
        : { ok: false, error: item?.reason ?? "unknown failure" };
    }
    const r = await bulkChangeAdStatus({
      action: "pause",
      metaAdIds: [metaId],
    });
    const item = r.items[0];
    return item?.status === "ok"
      ? { ok: true }
      : { ok: false, error: item?.reason ?? "unknown failure" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

/**
 * Evaluate one rule.
 *
 * `execute: false` (the default) is a genuine dry run — no action function is
 * reachable from this path, so a preview cannot mutate anything.
 */
export async function evaluateRuleById(
  ruleId: string,
  opts: { execute?: boolean; now?: Date } = {},
): Promise<RuleRunResult> {
  const now = opts.now ?? new Date();
  const rule = await prisma.adRule.findUnique({
    where: { id: ruleId },
    include: { adAccount: { select: { id: true, currency: true } } },
  });
  if (!rule) throw new Error("Rule not found");

  const scope = rule.scope as RuleScope;
  const symbol = currencySymbol(rule.adAccount.currency);

  const pure: RuleLike = {
    id: rule.id,
    // A PREVIEW evaluates the rule as if it were enabled, because the
    // question a preview answers is "what would this do if I turned it on?"
    // — and every rule is created disabled precisely so it can be previewed
    // first. Honouring `enabled` here would make every preview return
    // "rule is disabled", i.e. useless at the exact moment it is needed.
    // Execution still honours it: `runAllRules` only selects enabled rules,
    // and this flag is what stops a disabled rule acting if one is ever
    // executed directly.
    enabled: opts.execute ? rule.enabled : true,
    metric: rule.metric as RuleMetric,
    operator: rule.operator as RuleOperator,
    threshold: rule.threshold,
    windowDays: rule.windowDays,
    minSpendCents: rule.minSpendCents,
    action: rule.action === "pause" ? "pause" : "notify",
    cooldownHours: rule.cooldownHours,
    lastFiredAt: rule.lastFiredAt,
  };

  const metricsByEntity = await loadMetrics(
    rule.adAccountId,
    scope,
    rule.windowDays,
    rule.entityIds,
    now,
  );
  const names = await loadNames(rule.adAccountId, scope, [
    ...metricsByEntity.keys(),
  ]);

  const evaluations: EntityEvaluation[] = [];
  let fired = 0;
  let acted = 0;
  let failed = 0;

  for (const [entityId, metrics] of metricsByEntity) {
    const evaluation = evaluateRule(pure, metrics, now, symbol);
    const row: EntityEvaluation = {
      ...evaluation,
      entityId,
      entityName: names.get(entityId) ?? entityId,
    };

    if (evaluation.fires) {
      fired++;
      if (opts.execute && pure.action === "pause") {
        const res = await pauseEntity(scope, entityId);
        row.actionStatus = res.ok ? "ok" : "failed";
        row.actionError = res.error;
        if (res.ok) acted++;
        else failed++;
      }
    }
    evaluations.push(row);
  }

  if (opts.execute) {
    // `lastFiredAt` advances only when the rule actually fired on something.
    // Advancing it on every evaluation would start a cooldown that suppresses
    // the FIRST real firing — the rule would look enabled and simply never
    // act.
    await prisma.adRule.update({
      where: { id: rule.id },
      data: {
        lastEvaluatedAt: now,
        ...(fired > 0 ? { lastFiredAt: now } : {}),
      },
    });
  }

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    adAccountId: rule.adAccountId,
    scope,
    entitiesEvaluated: evaluations.length,
    fired,
    acted,
    failed,
    evaluations,
  };
}

export interface RulesRunReport {
  ranAt: string;
  rulesConsidered: number;
  totalFired: number;
  totalActed: number;
  totalFailed: number;
  results: RuleRunResult[];
  /** Rules that fired with action "notify", for the digest to pick up. */
  notifications: Array<{
    adAccountId: string;
    ruleName: string;
    entityName: string;
    explanation: string;
  }>;
}

/**
 * Run every enabled rule. Sequential, like every other multi-entity loop
 * here — rate limits and a linear audit log both matter more than speed on
 * a scheduled job.
 */
export async function runAllRules(
  opts: { execute?: boolean } = {},
): Promise<RulesRunReport> {
  const now = new Date();
  const rules = await prisma.adRule.findMany({
    where: { enabled: true, adAccount: { selectedForSync: true } },
    select: { id: true },
  });

  const results: RuleRunResult[] = [];
  const notifications: RulesRunReport["notifications"] = [];

  for (const r of rules) {
    try {
      const result = await evaluateRuleById(r.id, {
        execute: opts.execute,
        now,
      });
      results.push(result);

      const rule = await prisma.adRule.findUnique({
        where: { id: r.id },
        select: { action: true, name: true },
      });
      if (rule?.action === "notify") {
        for (const e of result.evaluations.filter((x) => x.fires)) {
          notifications.push({
            adAccountId: result.adAccountId,
            ruleName: result.ruleName,
            entityName: e.entityName,
            explanation: e.explanation,
          });
        }
      }
    } catch (e) {
      console.error(`[rules] rule ${r.id} failed:`, e);
    }
  }

  return {
    ranAt: now.toISOString(),
    rulesConsidered: rules.length,
    totalFired: results.reduce((s, r) => s + r.fired, 0),
    totalActed: results.reduce((s, r) => s + r.acted, 0),
    totalFailed: results.reduce((s, r) => s + r.failed, 0),
    results,
    notifications,
  };
}

/** Re-exported for the UI so it doesn't reach into lib directly. */
export { formatMetric, metricLabel };
