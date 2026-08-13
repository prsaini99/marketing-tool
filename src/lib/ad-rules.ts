/**
 * Automated rule evaluation — pure module, no I/O.
 *
 * This is the only feature in the product that spends or stops spending
 * money without a human in the loop, so the decision to fire is deliberately
 * separated from the machinery that acts on it: everything here is a pure
 * function over a metrics snapshot, and it can be reasoned about, tested and
 * argued with without a database or a Meta token.
 *
 * FOUR GUARDS, each of which exists because the obvious naive version is
 * dangerous:
 *
 * 1. MINIMUM SPEND. "CPA > ₹500" is true of an ad that spent ₹501 on one
 *    click and converted nobody. Acting on that pauses a campaign that has
 *    not yet had the chance to be judged. Every rule carries a spend floor
 *    and simply does not evaluate below it.
 *
 * 2. MINIMUM DATA DAYS. A three-day window with one day of delivery is not
 *    a three-day average. Requiring most of the window to have data stops a
 *    partially-synced account from reading as a performance collapse — which
 *    matters here because this codebase's syncs genuinely do fall behind.
 *
 * 3. COOLDOWN. Without it, a rule that fires on Monday re-fires every tick
 *    forever: the entity is already paused, the metrics are frozen, the
 *    condition stays true. That floods the audit log and the operator's
 *    inbox with the same event.
 *
 * 4. DIRECTION. Only PAUSE and NOTIFY exist. There is no "raise budget"
 *    action, and that is a product decision, not an omission: an automated
 *    system that can increase spend can lose money at machine speed, and no
 *    amount of thresholding makes that safe enough to ship unattended.
 *    Scaling up stays a human decision.
 */

export type RuleMetric = "cpa" | "spend" | "roas" | "ctr";
export type RuleOperator = "gt" | "lt";
export type RuleAction = "pause" | "notify";
export type RuleScope = "campaign" | "adset" | "ad";

export interface RuleLike {
  id: string;
  enabled: boolean;
  metric: RuleMetric;
  operator: RuleOperator;
  /**
   * Money metrics (cpa, spend) are in CENTS. Ratio metrics (roas, ctr) are
   * plain numbers — roas 2.5 means 2.5x, ctr 0.01 means 1%.
   */
  threshold: number;
  windowDays: number;
  /** Spend floor, in cents. Below this the rule does not evaluate at all. */
  minSpendCents: number;
  action: RuleAction;
  cooldownHours: number;
  lastFiredAt: Date | null;
}

/** Aggregated performance for one entity over the rule's window. */
export interface MetricsWindow {
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenueCents: number;
  /** How many distinct days in the window actually have data. */
  daysWithData: number;
}

export type SkipReason =
  | "rule_disabled"
  | "below_min_spend"
  | "insufficient_data"
  | "metric_undefined"
  | "in_cooldown"
  | "condition_not_met";

export interface Evaluation {
  ruleId: string;
  fires: boolean;
  skipReason?: SkipReason;
  /** The computed metric value, in the same unit as `threshold`. */
  observed: number | null;
  /** Human-readable explanation — shown in the UI and the audit trail. */
  explanation: string;
}

/**
 * At least this share of the window must have data before a rule may act.
 * Two-thirds is lenient enough for a normally-syncing account and strict
 * enough to catch a stalled sync.
 */
const MIN_DATA_COVERAGE = 2 / 3;

/**
 * Compute the metric. Returns null when it is genuinely undefined rather
 * than zero — CPA with no conversions is NOT "CPA of 0", and treating it as
 * zero would make every `cpa < X` rule fire on entities that converted
 * nobody, which is precisely backwards.
 */
export function computeMetric(
  metric: RuleMetric,
  m: MetricsWindow,
): number | null {
  switch (metric) {
    case "spend":
      return m.spendCents;
    case "cpa":
      return m.conversions > 0 ? m.spendCents / m.conversions : null;
    case "roas":
      return m.spendCents > 0 ? m.revenueCents / m.spendCents : null;
    case "ctr":
      return m.impressions > 0 ? m.clicks / m.impressions : null;
    default:
      return null;
  }
}

export function metricLabel(metric: RuleMetric): string {
  switch (metric) {
    case "cpa":
      return "CPA";
    case "spend":
      return "Spend";
    case "roas":
      return "ROAS";
    case "ctr":
      return "CTR";
  }
}

/** Format a metric value for humans, in its own unit. */
export function formatMetric(
  metric: RuleMetric,
  value: number,
  currencySymbol = "₹",
): string {
  if (metric === "cpa" || metric === "spend") {
    return `${currencySymbol}${Math.round(value / 100).toLocaleString()}`;
  }
  if (metric === "ctr") return `${(value * 100).toFixed(2)}%`;
  return `${value.toFixed(2)}x`;
}

export function isInCooldown(
  rule: Pick<RuleLike, "cooldownHours" | "lastFiredAt">,
  now: Date,
): boolean {
  if (!rule.lastFiredAt) return false;
  const elapsedMs = now.getTime() - rule.lastFiredAt.getTime();
  return elapsedMs < rule.cooldownHours * 3_600_000;
}

/**
 * Decide whether one rule fires against one entity's metrics.
 *
 * Order matters: the cheap structural guards run before the comparison, so
 * `skipReason` always names the FIRST reason the rule did not act. An
 * operator asking "why didn't this fire?" gets the actual answer rather than
 * "condition not met" for a rule that never got as far as the condition.
 */
export function evaluateRule(
  rule: RuleLike,
  metrics: MetricsWindow,
  now: Date = new Date(),
  currencySymbol = "₹",
): Evaluation {
  const base = { ruleId: rule.id, fires: false as const, observed: null };
  const label = metricLabel(rule.metric);

  if (!rule.enabled) {
    return { ...base, skipReason: "rule_disabled", explanation: "Rule is disabled." };
  }

  if (metrics.spendCents < rule.minSpendCents) {
    return {
      ...base,
      skipReason: "below_min_spend",
      explanation: `Spent ${formatMetric("spend", metrics.spendCents, currencySymbol)} in the window, below the ${formatMetric("spend", rule.minSpendCents, currencySymbol)} floor. Too early to judge.`,
    };
  }

  const requiredDays = Math.max(1, Math.ceil(rule.windowDays * MIN_DATA_COVERAGE));
  if (metrics.daysWithData < requiredDays) {
    return {
      ...base,
      skipReason: "insufficient_data",
      explanation: `Only ${metrics.daysWithData} of ${rule.windowDays} days have data (need ${requiredDays}), so insights may be behind.`,
    };
  }

  const observed = computeMetric(rule.metric, metrics);
  if (observed === null) {
    return {
      ...base,
      skipReason: "metric_undefined",
      explanation:
        rule.metric === "cpa"
          ? "No conversions in the window, so CPA is undefined. It is not treated as zero."
          : `${label} is undefined for this window.`,
    };
  }

  // Cooldown is checked AFTER the metric is computed so the UI can still
  // show what the rule would have seen — "would have fired, suppressed by
  // cooldown" is far more useful to an operator than a bare skip.
  if (isInCooldown(rule, now)) {
    return {
      ...base,
      observed,
      skipReason: "in_cooldown",
      explanation: `Already fired within the last ${rule.cooldownHours}h. Suppressed to avoid repeat actions.`,
    };
  }

  const met =
    rule.operator === "gt" ? observed > rule.threshold : observed < rule.threshold;

  const comparison = rule.operator === "gt" ? "above" : "below";
  const observedText = formatMetric(rule.metric, observed, currencySymbol);
  const thresholdText = formatMetric(rule.metric, rule.threshold, currencySymbol);

  if (!met) {
    return {
      ...base,
      observed,
      skipReason: "condition_not_met",
      explanation: `${label} is ${observedText}, not ${comparison} ${thresholdText}.`,
    };
  }

  return {
    ruleId: rule.id,
    fires: true,
    observed,
    explanation: `${label} is ${observedText} over ${rule.windowDays} day${rule.windowDays === 1 ? "" : "s"}, ${comparison} the ${thresholdText} threshold.`,
  };
}

/**
 * Plain-English summary of what a rule does, for the confirm modal.
 *
 * Every mutating feature in this codebase requires explicit confirmation
 * (PROJECT.md rule #3). A rule is unusual in that the user confirms it ONCE
 * and it then acts repeatedly without them, so the sentence they confirm has
 * to state the whole behaviour — including the guards, which are the part
 * that makes it safe and the part nobody would otherwise know about.
 */
export function describeRule(
  rule: Pick<
    RuleLike,
    "metric" | "operator" | "threshold" | "windowDays" | "action" | "minSpendCents" | "cooldownHours"
  >,
  scope: RuleScope,
  currencySymbol = "₹",
): string {
  const label = metricLabel(rule.metric);
  const dir = rule.operator === "gt" ? "rises above" : "falls below";
  const value = formatMetric(rule.metric, rule.threshold, currencySymbol);
  const act = rule.action === "pause" ? `pause the ${scope}` : "send a notification";
  const floor = formatMetric("spend", rule.minSpendCents, currencySymbol);

  return `If ${label} ${dir} ${value} over ${rule.windowDays} day${rule.windowDays === 1 ? "" : "s"}, ${act}. Only applies once the ${scope} has spent at least ${floor} in that window, and will not act again for ${rule.cooldownHours}h after firing.`;
}
