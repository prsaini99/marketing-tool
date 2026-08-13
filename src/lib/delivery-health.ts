/**
 * Delivery capacity — can this account actually spend money right now?
 *
 * Pure module, no I/O.
 *
 * WHY THIS EXISTS. Every status Meta reports can read ACTIVE while an
 * account delivers nothing. An ad set whose schedule ended in February and
 * whose lifetime budget is exhausted still comes back as
 * `effective_status: "ACTIVE"` — the object is enabled, it simply has no
 * budget left and no schedule left to run in. The campaign above it is
 * ACTIVE, the ads below it are ACTIVE, the account is ACTIVE with no
 * disable reason, and funding is fine. Nothing anywhere says "stopped".
 *
 * This happened on a real account for 68 days. Every dashboard read healthy
 * the entire time.
 *
 * So "is it delivering?" is not a status lookup — it is a question about
 * whether any ad set retains BOTH remaining budget AND a live schedule.
 * That is what this module answers.
 */

export type BlockReason =
  | "schedule_ended"
  | "schedule_not_started"
  | "budget_exhausted"
  | "parent_paused"
  | "not_active";

/**
 * `effective_status` values that PROVE an ad set cannot deliver.
 *
 * The relationship is asymmetric, and getting that backwards is the whole
 * trap this module exists for:
 *
 *   effectiveStatus !== ACTIVE  →  definitely cannot deliver.
 *   effectiveStatus === ACTIVE  →  proves NOTHING. An ad set whose schedule
 *                                  ended in February and whose budget is
 *                                  spent still reports ACTIVE.
 *
 * So this list is only ever used to rule delivery OUT. An ACTIVE reading
 * still has to survive the schedule and budget checks below.
 */
const BLOCKING_EFFECTIVE_STATUSES = new Set([
  "PAUSED",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "ARCHIVED",
  "DELETED",
  "IN_PROCESS",
  "WITH_ISSUES",
  "DISAPPROVED",
  "PENDING_REVIEW",
]);

export interface AdSetDeliveryInput {
  metaAdSetId: string;
  name: string;
  /** Operator intent. */
  status: string;
  /** Meta's delivery state, when synced. */
  effectiveStatus: string | null;
  startTime: Date | null;
  endTime: Date | null;
  /**
   * Remaining spend in cents. NULL means unknown — typically an ad set
   * synced before these fields were captured. Unknown is never treated as
   * zero: guessing "exhausted" would raise a false alarm on every legacy row.
   */
  budgetRemainingCents: number | null;
  dailyBudgetCents: number | null;
  lifetimeBudgetCents: number | null;
}

export interface AdSetDeliveryState {
  metaAdSetId: string;
  name: string;
  canDeliver: boolean;
  /** Populated only when canDeliver is false. */
  blockedBy: BlockReason | null;
  detail: string;
}

export interface AccountDeliveryHealth {
  /** Ad sets the operator believes are running. */
  intendedActive: number;
  /** Of those, how many actually can. */
  canDeliver: number;
  /** True when the operator thinks ads are running and none can. */
  allStopped: boolean;
  blocked: AdSetDeliveryState[];
  /** Counts per reason, for the alert body. */
  reasons: Partial<Record<BlockReason, number>>;
}

function isActiveIntent(status: string): boolean {
  return status.toUpperCase() === "ACTIVE";
}

/**
 * Assess one ad set.
 *
 * Order of checks matters: schedule before budget, because "ended on 16
 * February" is a more useful thing to tell someone than "no budget left",
 * even when both are true — the end date explains the budget.
 */
export function assessAdSet(input: AdSetDeliveryInput, now: Date): AdSetDeliveryState {
  const base = { metaAdSetId: input.metaAdSetId, name: input.name };

  if (!isActiveIntent(input.status)) {
    return {
      ...base,
      canDeliver: false,
      blockedBy: "not_active",
      detail: `Status is ${input.status}.`,
    };
  }

  // An ad set can be ACTIVE itself while its parent campaign is paused —
  // Meta reports status="ACTIVE", effective_status="CAMPAIGN_PAUSED". Only
  // effective_status knows about the parent, so skipping this check counts
  // an entire paused campaign's ad sets as live.
  const eff = (input.effectiveStatus ?? "").toUpperCase();
  if (eff && BLOCKING_EFFECTIVE_STATUSES.has(eff)) {
    return {
      ...base,
      canDeliver: false,
      blockedBy: eff.includes("PAUSED") ? "parent_paused" : "not_active",
      detail: `Meta reports ${eff}.`,
    };
  }

  if (input.endTime && input.endTime.getTime() <= now.getTime()) {
    return {
      ...base,
      canDeliver: false,
      blockedBy: "schedule_ended",
      detail: `Schedule ended ${input.endTime.toISOString().slice(0, 10)}.`,
    };
  }

  if (input.startTime && input.startTime.getTime() > now.getTime()) {
    return {
      ...base,
      canDeliver: false,
      blockedBy: "schedule_not_started",
      detail: `Scheduled to start ${input.startTime.toISOString().slice(0, 10)}.`,
    };
  }

  // Only meaningful for lifetime-budget ad sets. A daily-budget ad set
  // reports budget_remaining relative to today and refills tomorrow, so a
  // zero there is not an exhausted ad set — treating it as one would raise
  // an alarm every evening on a perfectly healthy account.
  const isLifetime =
    input.lifetimeBudgetCents != null && input.lifetimeBudgetCents > 0;
  if (
    isLifetime &&
    input.budgetRemainingCents != null &&
    input.budgetRemainingCents <= 0
  ) {
    return {
      ...base,
      canDeliver: false,
      blockedBy: "budget_exhausted",
      detail: "Lifetime budget fully spent.",
    };
  }

  return { ...base, canDeliver: true, blockedBy: null, detail: "Can deliver." };
}

/**
 * Roll ad sets up into an account-level verdict.
 *
 * `allStopped` deliberately requires at least one intended-active ad set. An
 * account where everything is paused on purpose is not an incident — it is a
 * decision, and alerting on it would train the operator to ignore the alert
 * that matters.
 */
export function assessAccountDelivery(
  adSets: AdSetDeliveryInput[],
  now: Date = new Date(),
): AccountDeliveryHealth {
  const intended = adSets.filter((a) => isActiveIntent(a.status));
  const states = intended.map((a) => assessAdSet(a, now));
  const blocked = states.filter((s) => !s.canDeliver);
  const canDeliver = states.length - blocked.length;

  const reasons: Partial<Record<BlockReason, number>> = {};
  for (const b of blocked) {
    if (b.blockedBy) reasons[b.blockedBy] = (reasons[b.blockedBy] ?? 0) + 1;
  }

  return {
    intendedActive: intended.length,
    canDeliver,
    allStopped: intended.length > 0 && canDeliver === 0,
    blocked,
    reasons,
  };
}

/** Human summary for the alert body. */
export function describeDeliveryHealth(h: AccountDeliveryHealth): string {
  if (h.intendedActive === 0) {
    return "No ad sets are set to active, so nothing is expected to deliver.";
  }
  if (h.allStopped) {
    const parts: string[] = [];
    if (h.reasons.schedule_ended) {
      parts.push(`${h.reasons.schedule_ended} past their end date`);
    }
    if (h.reasons.budget_exhausted) {
      parts.push(`${h.reasons.budget_exhausted} out of lifetime budget`);
    }
    if (h.reasons.schedule_not_started) {
      parts.push(`${h.reasons.schedule_not_started} not started yet`);
    }
    if (h.reasons.parent_paused) {
      parts.push(`${h.reasons.parent_paused} in a paused campaign`);
    }
    const because = parts.length > 0 ? `: ${parts.join(", ")}` : "";
    return `All ${h.intendedActive} active ad sets are unable to deliver${because}. The account is spending nothing despite everything reading ACTIVE.`;
  }
  if (h.blocked.length > 0) {
    return `${h.blocked.length} of ${h.intendedActive} active ad sets cannot deliver; ${h.canDeliver} still can.`;
  }
  return `All ${h.intendedActive} active ad sets can deliver.`;
}

/**
 * Whether ONE campaign's ad sets can currently deliver.
 *
 * A campaign's own `status` is operator intent and nothing more. A campaign
 * reading ACTIVE whose every ad set ended in February is not running, has not
 * run for months, and showing it as plain "Active" next to zero spend is the
 * single most misleading thing a media buyer can be shown: it makes correct
 * numbers look like broken reporting.
 *
 * Returns null when the campaign is not ACTIVE (nothing to contradict), when
 * it has no ad sets synced yet (unknown, not blocked), or when at least one
 * ad set genuinely can deliver.
 */
export function campaignBlockReason(
  status: string,
  adSets: AdSetDeliveryInput[],
  now: Date = new Date(),
): { reason: BlockReason; detail: string } | null {
  if (!isActiveIntent(status)) return null;
  const intended = adSets.filter((a) => isActiveIntent(a.status));
  if (intended.length === 0) return null;

  const states = intended.map((a) => assessAdSet(a, now));
  if (states.some((st) => st.canDeliver)) return null;

  // All blocked. Report the most common reason, and on a tie the first in
  // assessAdSet's own precedence order, so the message stays stable rather
  // than flipping between equally-true explanations on each render.
  const counts = new Map<BlockReason, number>();
  for (const st of states) {
    if (st.blockedBy) counts.set(st.blockedBy, (counts.get(st.blockedBy) ?? 0) + 1);
  }
  let top: BlockReason | null = null;
  let best = 0;
  for (const [reason, n] of counts) {
    if (n > best) {
      best = n;
      top = reason;
    }
  }
  if (!top) return null;
  const example = states.find((st) => st.blockedBy === top);
  return { reason: top, detail: example?.detail ?? "" };
}
