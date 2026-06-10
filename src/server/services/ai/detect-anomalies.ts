/**
 * Daily anomaly detection — the engine behind /dashboard/alerts.
 *
 * For every selected-for-sync account:
 *   1. Pull the last 8 days of campaign-level insights (yesterday + the
 *      7-day baseline).
 *   2. Diff yesterday's account totals against the baseline mean.
 *   3. Flag anything that shifted meaningfully — spend, CPM, CTR, CPC, or
 *      "delivery stopped" (yesterday went to zero while the baseline was
 *      non-zero). Each anomaly gets a `kind` slug, severity, and the raw
 *      numbers.
 *   4. If any anomalies fired, ask the LLM for a 2–3 sentence diagnosis
 *      grounded in the structured numbers.
 *   5. Upsert one Alert row per (account, day, kind) — the unique
 *      constraint means re-running the scan replaces in place rather than
 *      stacking duplicates.
 *
 * Anti-noise rules baked into the thresholds: ignore tiny-base shifts
 * (spend ≥ ₹500 or ~$5 baseline before flagging % deltas; impressions ≥
 * 1000 before flagging CTR/CPM deltas). Without those, brand-new accounts
 * generate alert spam every morning.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { complete } from "@/lib/llm/chat";
import { metaClient } from "@/lib/meta/client";

interface DailyTotals {
  date: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  conversionsCount: number;
  revenueCents: number;
}

interface DetectedAnomaly {
  kind: string;
  severity: "high" | "medium" | "low" | "info";
  title: string;
  metric: string;
  current: number;
  baseline: number;
  deltaPct: number;
}

// % deltas under this are noise — don't bother flagging.
const PCT_THRESHOLD = 0.30; // 30%
// Absolute floors to suppress alerts from tiny-base accounts.
const SPEND_BASELINE_CENTS = 500 * 100; // baseline >= ~₹500 / $5 worth of spend
const IMPRESSION_FLOOR = 1000; // baseline impressions for CTR/CPM signals
// Need at least this many conversions in the baseline before flagging
// conversion/ROAS deltas — otherwise a 3-conversion-to-1 day flags as -67%
// which is statistical noise on tiny samples.
const CONVERSIONS_BASELINE_FLOOR = 5;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function safeDiv(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}
function pctDelta(cur: number, base: number): number {
  if (base === 0) return cur === 0 ? 0 : 1;
  return (cur - base) / base;
}

interface AccountScanResult {
  accountId: string;
  metaAdAccountId: string;
  accountName: string;
  anomaliesWritten: number;
  skipped?: string; // reason if we didn't process the account
}

export interface ScanResult {
  scannedAt: string;
  accountsScanned: number;
  totalAnomalies: number;
  perAccount: AccountScanResult[];
}

export async function detectAnomaliesForAllAccounts(): Promise<ScanResult> {
  const accounts = await prisma.metaAdAccount.findMany({
    where: { selectedForSync: true },
    select: {
      id: true,
      metaAdAccountId: true,
      name: true,
      currency: true,
      business: { select: { name: true, connectionId: true } },
    },
    distinct: ["metaAdAccountId"],
  });

  const perAccount: AccountScanResult[] = [];
  let totalAnomalies = 0;
  for (const acc of accounts) {
    // Run the four scans sequentially per account. They share the same
    // `forDate` (most-recent insights day or today), so re-running the cron
    // is idempotent across all alert kinds.
    const accountSummary = await scanAccount(acc);
    const adSetCount = await scanAdSetsForAccount(acc);
    const policyCount = await scanPolicyForAccount(acc);
    const overlapCount = await scanAudienceOverlapForAccount(acc);

    const total =
      accountSummary.anomaliesWritten + adSetCount + policyCount + overlapCount;
    totalAnomalies += total;
    perAccount.push({
      ...accountSummary,
      anomaliesWritten: total,
    });
  }

  return {
    scannedAt: new Date().toISOString(),
    accountsScanned: accounts.length,
    totalAnomalies,
    perAccount,
  };
}

async function scanAccount(account: {
  id: string;
  metaAdAccountId: string;
  name: string;
  currency: string;
  business: { name: string };
}): Promise<AccountScanResult> {
  const base: AccountScanResult = {
    accountId: account.id,
    metaAdAccountId: account.metaAdAccountId,
    accountName: account.name,
    anomaliesWritten: 0,
  };

  // Anchor on the latest data we have — "today" would over-state when sync
  // hasn't run yet. We treat the most recent day with data as "yesterday".
  const latest = await prisma.insightsSnapshot.findFirst({
    where: { adAccountId: account.id, level: "campaign" },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) {
    return { ...base, skipped: "no insights data" };
  }

  const yesterday = latest.date;
  const baselineTo = new Date(yesterday);
  baselineTo.setUTCDate(baselineTo.getUTCDate() - 1);
  const baselineFrom = new Date(baselineTo);
  baselineFrom.setUTCDate(baselineFrom.getUTCDate() - 6);

  // Pull 8 days at once, then split.
  const rows = await prisma.insightsSnapshot.findMany({
    where: {
      adAccountId: account.id,
      level: "campaign",
      date: { gte: baselineFrom, lte: yesterday },
    },
    select: {
      date: true,
      spendCents: true,
      impressions: true,
      clicks: true,
      conversionsCount: true,
      revenueCents: true,
    },
  });

  // Aggregate per day.
  const byDay = new Map<string, DailyTotals>();
  for (const r of rows) {
    const k = isoDate(r.date);
    const cur = byDay.get(k) ?? {
      date: k,
      spendCents: 0,
      impressions: 0,
      clicks: 0,
      conversionsCount: 0,
      revenueCents: 0,
    };
    cur.spendCents += r.spendCents;
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    cur.conversionsCount += r.conversionsCount;
    cur.revenueCents += r.revenueCents;
    byDay.set(k, cur);
  }

  const yKey = isoDate(yesterday);
  const yTotals = byDay.get(yKey) ?? {
    date: yKey,
    spendCents: 0,
    impressions: 0,
    clicks: 0,
    conversionsCount: 0,
    revenueCents: 0,
  };

  const baselineDays: DailyTotals[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(baselineTo);
    d.setUTCDate(d.getUTCDate() - i);
    const k = isoDate(d);
    if (byDay.has(k)) baselineDays.push(byDay.get(k)!);
  }
  if (baselineDays.length < 3) {
    // Not enough baseline to compare; would generate noisy false-positives.
    return { ...base, skipped: "baseline too thin" };
  }

  const baselineMean = {
    spendCents:
      baselineDays.reduce((s, r) => s + r.spendCents, 0) / baselineDays.length,
    impressions:
      baselineDays.reduce((s, r) => s + r.impressions, 0) / baselineDays.length,
    clicks:
      baselineDays.reduce((s, r) => s + r.clicks, 0) / baselineDays.length,
    conversionsCount:
      baselineDays.reduce((s, r) => s + r.conversionsCount, 0) /
      baselineDays.length,
    revenueCents:
      baselineDays.reduce((s, r) => s + r.revenueCents, 0) /
      baselineDays.length,
  };

  const anomalies: DetectedAnomaly[] = [];

  // Delivery stopped — only worth flagging if there's normally meaningful
  // spend; baseline floor keeps this quiet on tiny accounts.
  if (
    yTotals.spendCents === 0 &&
    baselineMean.spendCents >= SPEND_BASELINE_CENTS
  ) {
    anomalies.push({
      kind: "delivery_stopped",
      severity: "high",
      title: "Delivery stopped yesterday",
      metric: "spendCents",
      current: 0,
      baseline: baselineMean.spendCents,
      deltaPct: -1,
    });
  } else if (baselineMean.spendCents >= SPEND_BASELINE_CENTS) {
    // Spend delta.
    const d = pctDelta(yTotals.spendCents, baselineMean.spendCents);
    if (Math.abs(d) >= PCT_THRESHOLD) {
      anomalies.push({
        kind: d > 0 ? "spend_spike" : "spend_drop",
        severity: Math.abs(d) >= 0.6 ? "high" : "medium",
        title:
          d > 0
            ? `Spend up ${Math.round(d * 100)}% vs baseline`
            : `Spend down ${Math.abs(Math.round(d * 100))}% vs baseline`,
        metric: "spendCents",
        current: yTotals.spendCents,
        baseline: baselineMean.spendCents,
        deltaPct: d,
      });
    }
  }

  // CTR delta — only if the impression base is non-trivial.
  if (
    yTotals.impressions >= IMPRESSION_FLOOR &&
    baselineMean.impressions >= IMPRESSION_FLOOR
  ) {
    const yCtr = safeDiv(yTotals.clicks, yTotals.impressions);
    const baseCtr = safeDiv(baselineMean.clicks, baselineMean.impressions);
    const d = pctDelta(yCtr, baseCtr);
    if (Math.abs(d) >= PCT_THRESHOLD && baseCtr > 0) {
      anomalies.push({
        kind: d > 0 ? "ctr_spike" : "ctr_drop",
        severity: Math.abs(d) >= 0.5 ? "medium" : "low",
        title:
          d > 0
            ? `CTR up ${Math.round(d * 100)}% (${(yCtr * 100).toFixed(2)}% vs ${(baseCtr * 100).toFixed(2)}%)`
            : `CTR down ${Math.abs(Math.round(d * 100))}% (${(yCtr * 100).toFixed(2)}% vs ${(baseCtr * 100).toFixed(2)}%)`,
        metric: "ctr",
        current: yCtr,
        baseline: baseCtr,
        deltaPct: d,
      });
    }
  }

  // CPM delta — costs trending the wrong way is worth a heads-up.
  if (
    yTotals.impressions >= IMPRESSION_FLOOR &&
    baselineMean.impressions >= IMPRESSION_FLOOR
  ) {
    const yCpm = safeDiv(yTotals.spendCents * 1000, yTotals.impressions);
    const baseCpm = safeDiv(
      baselineMean.spendCents * 1000,
      baselineMean.impressions,
    );
    const d = pctDelta(yCpm, baseCpm);
    if (Math.abs(d) >= PCT_THRESHOLD && baseCpm > 0) {
      anomalies.push({
        kind: d > 0 ? "cpm_spike" : "cpm_drop",
        severity: Math.abs(d) >= 0.5 ? "medium" : "low",
        title:
          d > 0
            ? `CPM up ${Math.round(d * 100)}% vs baseline`
            : `CPM down ${Math.abs(Math.round(d * 100))}% vs baseline`,
        metric: "cpm",
        current: yCpm,
        baseline: baseCpm,
        deltaPct: d,
      });
    }
  }

  // ROAS delta — the money metric. Requires actual revenue both periods;
  // skip lead-gen / no-tracking accounts (where revenue is always 0) cleanly.
  if (
    baselineMean.revenueCents > 0 &&
    yTotals.spendCents > 0 &&
    baselineMean.spendCents > 0
  ) {
    const yRoas = safeDiv(yTotals.revenueCents, yTotals.spendCents);
    const baseRoas = safeDiv(baselineMean.revenueCents, baselineMean.spendCents);
    const d = pctDelta(yRoas, baseRoas);
    if (Math.abs(d) >= PCT_THRESHOLD && baseRoas > 0) {
      anomalies.push({
        kind: d > 0 ? "roas_spike" : "roas_drop",
        // ROAS drops hurt more than spikes — bias the severity.
        severity:
          d < -0.5 ? "high" : Math.abs(d) >= 0.5 ? "medium" : "medium",
        title:
          d > 0
            ? `ROAS up ${Math.round(d * 100)}% (${yRoas.toFixed(2)}x vs ${baseRoas.toFixed(2)}x)`
            : `ROAS down ${Math.abs(Math.round(d * 100))}% (${yRoas.toFixed(2)}x vs ${baseRoas.toFixed(2)}x)`,
        metric: "roas",
        current: yRoas,
        baseline: baseRoas,
        deltaPct: d,
      });
    }
  }

  // Conversions delta — meaningful for lead-gen accounts that won't have
  // revenue. Requires a non-trivial baseline so 5→2 doesn't flag.
  if (baselineMean.conversionsCount >= CONVERSIONS_BASELINE_FLOOR) {
    const d = pctDelta(yTotals.conversionsCount, baselineMean.conversionsCount);
    if (Math.abs(d) >= PCT_THRESHOLD) {
      // Special-case: conversions went to zero is a "collapsed" signal.
      const collapsed = yTotals.conversionsCount === 0;
      anomalies.push({
        kind: collapsed
          ? "conversions_collapsed"
          : d > 0
            ? "conversions_spike"
            : "conversions_drop",
        severity: collapsed
          ? "high"
          : d < -0.5
            ? "high"
            : Math.abs(d) >= 0.5
              ? "medium"
              : "low",
        title: collapsed
          ? `Conversions dropped to 0 (baseline ${Math.round(baselineMean.conversionsCount)}/day)`
          : d > 0
            ? `Conversions up ${Math.round(d * 100)}% (${yTotals.conversionsCount} vs ${Math.round(baselineMean.conversionsCount)} baseline)`
            : `Conversions down ${Math.abs(Math.round(d * 100))}% (${yTotals.conversionsCount} vs ${Math.round(baselineMean.conversionsCount)} baseline)`,
        metric: "conversionsCount",
        current: yTotals.conversionsCount,
        baseline: baselineMean.conversionsCount,
        deltaPct: d,
      });
    }
  }

  if (anomalies.length === 0) {
    return base;
  }

  // One LLM call per account-with-anomalies — diagnose all of them together
  // so the body reads as one coherent explanation, not bullet-fragments.
  const body = await diagnoseAnomalies({
    accountName: account.name,
    businessName: account.business.name,
    currency: account.currency,
    yesterday: yKey,
    yTotals,
    baselineMean,
    anomalies,
  });

  // Persist — one row per kind so the same anomaly recurring on a different
  // day gets its own row, but re-running today's scan upserts in place.
  let written = 0;
  for (const a of anomalies) {
    await prisma.alert.upsert({
      where: {
        adAccountId_forDate_kind_entityId: {
          adAccountId: account.id,
          forDate: yesterday,
          kind: a.kind,
          entityId: "",
        },
      },
      create: {
        adAccountId: account.id,
        forDate: yesterday,
        kind: a.kind,
        entityType: "account",
        entityId: "",
        entityName: null,
        severity: a.severity,
        title: a.title,
        body,
        metrics: {
          metric: a.metric,
          current: a.current,
          baseline: a.baseline,
          deltaPct: a.deltaPct,
          yesterdaySpendCents: yTotals.spendCents,
          baselineSpendCents: Math.round(baselineMean.spendCents),
        } as Prisma.InputJsonValue,
      },
      update: {
        severity: a.severity,
        title: a.title,
        body,
        metrics: {
          metric: a.metric,
          current: a.current,
          baseline: a.baseline,
          deltaPct: a.deltaPct,
          yesterdaySpendCents: yTotals.spendCents,
          baselineSpendCents: Math.round(baselineMean.spendCents),
        } as Prisma.InputJsonValue,
      },
    });
    written++;
  }

  return { ...base, anomaliesWritten: written };
}

async function diagnoseAnomalies(input: {
  accountName: string;
  businessName: string;
  currency: string;
  yesterday: string;
  yTotals: DailyTotals;
  baselineMean: {
    spendCents: number;
    impressions: number;
    clicks: number;
    conversionsCount: number;
    revenueCents: number;
  };
  anomalies: DetectedAnomaly[];
}): Promise<string> {
  const fm = (cents: number) => (cents / 100).toFixed(2);
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const yCtr = safeDiv(input.yTotals.clicks, input.yTotals.impressions);
  const bCtr = safeDiv(
    input.baselineMean.clicks,
    input.baselineMean.impressions,
  );

  const yRoas = safeDiv(input.yTotals.revenueCents, input.yTotals.spendCents);
  const bRoas = safeDiv(
    input.baselineMean.revenueCents,
    input.baselineMean.spendCents,
  );

  const block = `ACCOUNT: ${input.businessName} — ${input.accountName} (${input.currency})
DATE FLAGGED: ${input.yesterday}

YESTERDAY:
  Spend: ${fm(input.yTotals.spendCents)}
  Impressions: ${input.yTotals.impressions}
  Clicks: ${input.yTotals.clicks}
  CTR: ${pct(yCtr)}
  Conversions: ${input.yTotals.conversionsCount}
  Revenue: ${fm(input.yTotals.revenueCents)}
  ROAS: ${yRoas.toFixed(2)}x

BASELINE (prior 7-day mean):
  Spend: ${fm(input.baselineMean.spendCents)}
  Impressions: ${Math.round(input.baselineMean.impressions)}
  Clicks: ${Math.round(input.baselineMean.clicks)}
  CTR: ${pct(bCtr)}
  Conversions: ${Math.round(input.baselineMean.conversionsCount)}
  Revenue: ${fm(input.baselineMean.revenueCents)}
  ROAS: ${bRoas.toFixed(2)}x

ANOMALIES DETECTED:
${input.anomalies.map((a) => `  - ${a.kind}: ${a.title}`).join("\n")}`;

  const system = `You are a media-buying analyst writing a 2–3 sentence morning brief for an agency strategist. Read the structured anomaly data and write the cause-and-recommendation explanation in plain English.

Rules:
- 2–3 short sentences total. No bullet lists. No headers.
- Be honest about uncertainty — if you can't pinpoint a cause from the data, say "likely cause is X or Y; check ad-set delivery / budget / scheduling to confirm."
- Common causes you can suggest when they fit: budget exhausted, audience expansion or restriction, creative fatigue, account-level pause, ad disapproval, schedule change, holiday/seasonal effect, learning-phase reset, landing-page issues, conversion tracking break.
- For ROAS / conversion anomalies specifically: check whether spend changed too (if both moved together, it's a volume story; if ROAS moved alone, it's a quality story — audience, creative, or landing page).
- Don't invent metrics.
- No clichés ("crushed it", "synergy", "game-changer").`;

  return complete(`Diagnose:\n\n${block}`, {
    system,
    temperature: 0.4,
    maxTokens: 220,
  });
}

// ─── Ad-set level scan ──────────────────────────────────────────────────
//
// Catches what account totals hide — e.g. account spend is up 10% but
// inside one campaign, one ad-set has gone to zero. Same delta logic +
// thresholds as the account scan, but capped to the top N anomalies per
// account to prevent inbox spam.

const ADSET_ALERT_CAP_PER_ACCOUNT = 5;

async function scanAdSetsForAccount(account: {
  id: string;
  currency: string;
}): Promise<number> {
  const latest = await prisma.insightsSnapshot.findFirst({
    where: { adAccountId: account.id, level: "adset" },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) return 0;

  const yesterday = latest.date;
  const baselineTo = new Date(yesterday);
  baselineTo.setUTCDate(baselineTo.getUTCDate() - 1);
  const baselineFrom = new Date(baselineTo);
  baselineFrom.setUTCDate(baselineFrom.getUTCDate() - 6);

  // Pull 8 days of ad-set rows for the account in one query.
  const rows = await prisma.insightsSnapshot.findMany({
    where: {
      adAccountId: account.id,
      level: "adset",
      date: { gte: baselineFrom, lte: yesterday },
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

  // Aggregate per ad-set per day.
  const byAdSetDay = new Map<string, Map<string, DailyTotals>>();
  for (const r of rows) {
    const k = isoDate(r.date);
    let perAdSet = byAdSetDay.get(r.entityId);
    if (!perAdSet) {
      perAdSet = new Map();
      byAdSetDay.set(r.entityId, perAdSet);
    }
    const cur = perAdSet.get(k) ?? {
      date: k,
      spendCents: 0,
      impressions: 0,
      clicks: 0,
      conversionsCount: 0,
      revenueCents: 0,
    };
    cur.spendCents += r.spendCents;
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    cur.conversionsCount += r.conversionsCount;
    cur.revenueCents += r.revenueCents;
    perAdSet.set(k, cur);
  }

  const yKey = isoDate(yesterday);

  // Build candidate anomalies across every ad-set.
  interface Candidate {
    metaAdSetId: string;
    anomaly: DetectedAnomaly;
  }
  const candidates: Candidate[] = [];

  for (const [adSetId, perDay] of byAdSetDay) {
    const yTotals =
      perDay.get(yKey) ?? {
        date: yKey,
        spendCents: 0,
        impressions: 0,
        clicks: 0,
        conversionsCount: 0,
        revenueCents: 0,
      };

    const baselineDays: DailyTotals[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(baselineTo);
      d.setUTCDate(d.getUTCDate() - i);
      const k = isoDate(d);
      if (perDay.has(k)) baselineDays.push(perDay.get(k)!);
    }
    if (baselineDays.length < 3) continue;

    const baselineMean = {
      spendCents:
        baselineDays.reduce((s, r) => s + r.spendCents, 0) /
        baselineDays.length,
      impressions:
        baselineDays.reduce((s, r) => s + r.impressions, 0) /
        baselineDays.length,
      clicks:
        baselineDays.reduce((s, r) => s + r.clicks, 0) / baselineDays.length,
      conversionsCount:
        baselineDays.reduce((s, r) => s + r.conversionsCount, 0) /
        baselineDays.length,
      revenueCents:
        baselineDays.reduce((s, r) => s + r.revenueCents, 0) /
        baselineDays.length,
    };

    // Reuse the account-level delta logic, but a tighter spend floor (₹200)
    // because ad-sets are smaller than accounts by definition.
    const ADSET_SPEND_FLOOR = 200 * 100;

    if (
      yTotals.spendCents === 0 &&
      baselineMean.spendCents >= ADSET_SPEND_FLOOR
    ) {
      candidates.push({
        metaAdSetId: adSetId,
        anomaly: {
          kind: "adset_delivery_stopped",
          severity: "high",
          title: "Delivery stopped",
          metric: "spendCents",
          current: 0,
          baseline: baselineMean.spendCents,
          deltaPct: -1,
        },
      });
      continue;
    }

    if (baselineMean.spendCents >= ADSET_SPEND_FLOOR) {
      const d = pctDelta(yTotals.spendCents, baselineMean.spendCents);
      if (Math.abs(d) >= PCT_THRESHOLD) {
        candidates.push({
          metaAdSetId: adSetId,
          anomaly: {
            kind: d > 0 ? "adset_spend_spike" : "adset_spend_drop",
            severity: Math.abs(d) >= 0.6 ? "high" : "medium",
            title:
              d > 0
                ? `Spend up ${Math.round(d * 100)}% vs baseline`
                : `Spend down ${Math.abs(Math.round(d * 100))}% vs baseline`,
            metric: "spendCents",
            current: yTotals.spendCents,
            baseline: baselineMean.spendCents,
            deltaPct: d,
          },
        });
      }
    }

    if (
      baselineMean.revenueCents > 0 &&
      yTotals.spendCents > 0 &&
      baselineMean.spendCents > 0
    ) {
      const yRoas = safeDiv(yTotals.revenueCents, yTotals.spendCents);
      const baseRoas = safeDiv(
        baselineMean.revenueCents,
        baselineMean.spendCents,
      );
      const d = pctDelta(yRoas, baseRoas);
      if (Math.abs(d) >= PCT_THRESHOLD && baseRoas > 0) {
        candidates.push({
          metaAdSetId: adSetId,
          anomaly: {
            kind: d > 0 ? "adset_roas_spike" : "adset_roas_drop",
            severity: d < -0.5 ? "high" : "medium",
            title:
              d > 0
                ? `ROAS up ${Math.round(d * 100)}% (${yRoas.toFixed(2)}x vs ${baseRoas.toFixed(2)}x)`
                : `ROAS down ${Math.abs(Math.round(d * 100))}% (${yRoas.toFixed(2)}x vs ${baseRoas.toFixed(2)}x)`,
            metric: "roas",
            current: yRoas,
            baseline: baseRoas,
            deltaPct: d,
          },
        });
      }
    }
  }

  if (candidates.length === 0) return 0;

  // Severity-then-magnitude sort, then cap at N per account so a chaotic
  // morning doesn't spam 30 ad-set alerts.
  const severityRank = (s: string) =>
    s === "high" ? 0 : s === "medium" ? 1 : s === "low" ? 2 : 3;
  candidates.sort((a, b) => {
    const sd = severityRank(a.anomaly.severity) - severityRank(b.anomaly.severity);
    if (sd !== 0) return sd;
    return Math.abs(b.anomaly.deltaPct) - Math.abs(a.anomaly.deltaPct);
  });
  const top = candidates.slice(0, ADSET_ALERT_CAP_PER_ACCOUNT);

  // Resolve ad-set names in one query.
  const adSetMeta = await prisma.adSet.findMany({
    where: {
      adAccountId: account.id,
      metaAdSetId: { in: top.map((c) => c.metaAdSetId) },
    },
    select: { metaAdSetId: true, name: true },
  });
  const nameById = new Map(adSetMeta.map((a) => [a.metaAdSetId, a.name]));

  let written = 0;
  for (const c of top) {
    const adSetName = nameById.get(c.metaAdSetId) ?? c.metaAdSetId;
    const body = buildAdSetBody(c.anomaly, account.currency);
    await prisma.alert.upsert({
      where: {
        adAccountId_forDate_kind_entityId: {
          adAccountId: account.id,
          forDate: yesterday,
          kind: c.anomaly.kind,
          entityId: c.metaAdSetId,
        },
      },
      create: {
        adAccountId: account.id,
        forDate: yesterday,
        kind: c.anomaly.kind,
        entityType: "adset",
        entityId: c.metaAdSetId,
        entityName: adSetName,
        severity: c.anomaly.severity,
        title: `${adSetName} · ${c.anomaly.title}`,
        body,
        metrics: {
          metric: c.anomaly.metric,
          current: c.anomaly.current,
          baseline: c.anomaly.baseline,
          deltaPct: c.anomaly.deltaPct,
        } as Prisma.InputJsonValue,
      },
      update: {
        severity: c.anomaly.severity,
        title: `${adSetName} · ${c.anomaly.title}`,
        body,
        entityName: adSetName,
        metrics: {
          metric: c.anomaly.metric,
          current: c.anomaly.current,
          baseline: c.anomaly.baseline,
          deltaPct: c.anomaly.deltaPct,
        } as Prisma.InputJsonValue,
      },
    });
    written++;
  }
  return written;
}

function buildAdSetBody(a: DetectedAnomaly, currency: string): string {
  const fm = (n: number) => (n / 100).toFixed(2);
  if (a.kind === "adset_delivery_stopped") {
    return `Spent ${fm(a.baseline)} ${currency}/day on average over the prior 7 days; yesterday: 0. Most common causes are budget exhaustion, audience too narrow, or a manual pause at the ad-set or ad level. Check ad-set status and budget pacing.`;
  }
  if (a.kind === "adset_spend_spike" || a.kind === "adset_spend_drop") {
    return `Spend yesterday: ${fm(a.current)} ${currency}. 7-day baseline: ${fm(a.baseline)} ${currency}/day. Common causes for this kind of shift: budget change, audience expansion or restriction, schedule change, or a new winning ad inside the ad-set pulling more delivery.`;
  }
  if (a.kind === "adset_roas_spike" || a.kind === "adset_roas_drop") {
    return `ROAS yesterday: ${a.current.toFixed(2)}x. 7-day baseline: ${a.baseline.toFixed(2)}x. A ROAS shift without a matching spend shift usually means a quality change — different audience reaching, a new creative, or a landing-page issue. Check what changed in the ad-set yesterday.`;
  }
  return `Yesterday: ${a.current.toFixed(2)}. Baseline: ${a.baseline.toFixed(2)}. Delta: ${Math.round(a.deltaPct * 100)}%.`;
}

// ─── Policy / rejection scan ────────────────────────────────────────────
//
// Reads Ad rows we've synced; flags anything whose effective_status is
// DISAPPROVED or WITH_ISSUES. Body is built from Meta's own issues_info
// — strategist sees exactly what Meta said is wrong.

interface RawIssueInfo {
  level?: string;
  error_code?: number;
  error_message?: string;
  error_summary?: string;
}

const POLICY_ALERT_CAP_PER_ACCOUNT = 10;

async function scanPolicyForAccount(account: {
  id: string;
}): Promise<number> {
  const ads = await prisma.ad.findMany({
    where: {
      adAccountId: account.id,
      effectiveStatus: { in: ["DISAPPROVED", "WITH_ISSUES"] },
    },
    select: {
      metaAdId: true,
      name: true,
      effectiveStatus: true,
      issuesInfo: true,
    },
    take: POLICY_ALERT_CAP_PER_ACCOUNT,
  });
  if (ads.length === 0) return 0;

  // Use the latest insights day if available, else today, so the alert
  // groups with the rest of today's scan.
  const latest = await prisma.insightsSnapshot.findFirst({
    where: { adAccountId: account.id, level: "campaign" },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const forDate = latest?.date ?? new Date();

  let written = 0;
  for (const ad of ads) {
    const kind =
      ad.effectiveStatus === "DISAPPROVED" ? "ad_disapproved" : "ad_with_issues";
    const severity = ad.effectiveStatus === "DISAPPROVED" ? "high" : "medium";

    let body = "Meta has flagged this ad. Review and fix in Ads Manager.";
    const issues = (ad.issuesInfo ?? null) as RawIssueInfo[] | null;
    if (issues && issues.length > 0) {
      body = issues
        .map((i) => {
          const summary = i.error_summary ?? i.error_message ?? "Issue";
          const detail = i.error_message ?? "";
          return detail && detail !== summary
            ? `• ${summary} — ${detail}`
            : `• ${summary}`;
        })
        .join("\n");
    }

    const title =
      ad.effectiveStatus === "DISAPPROVED"
        ? `${ad.name} · disapproved`
        : `${ad.name} · has issues`;

    await prisma.alert.upsert({
      where: {
        adAccountId_forDate_kind_entityId: {
          adAccountId: account.id,
          forDate,
          kind,
          entityId: ad.metaAdId,
        },
      },
      create: {
        adAccountId: account.id,
        forDate,
        kind,
        entityType: "ad",
        entityId: ad.metaAdId,
        entityName: ad.name,
        severity,
        title,
        body,
        metrics: {
          effectiveStatus: ad.effectiveStatus,
          issuesCount: issues?.length ?? 0,
        } as Prisma.InputJsonValue,
      },
      update: {
        severity,
        title,
        body,
        entityName: ad.name,
        metrics: {
          effectiveStatus: ad.effectiveStatus,
          issuesCount: issues?.length ?? 0,
        } as Prisma.InputJsonValue,
      },
    });
    written++;
  }

  return written;
}

// ─── Audience overlap scan ──────────────────────────────────────────────
//
// For the top-N most recently synced custom audiences in an account, ask
// Meta how many users overlap pairwise. Flag pairs where overlap exceeds
// 30% of the anchor's size — that's the threshold at which two ad-sets
// targeting them effectively compete for the same users.
//
// Capped tightly (3 anchors × 2 others) to keep Meta API calls under 5
// per account per day. Lookalikes and other audiences Meta won't compare
// just return no rows — we skip silently.

const OVERLAP_ANCHORS = 3;
const OVERLAP_COMPARES = 2;
const OVERLAP_THRESHOLD = 0.30; // 30% of anchor size
const OVERLAP_MIN_AUDIENCE_SIZE = 1000; // skip tiny / no-count audiences

async function scanAudienceOverlapForAccount(account: {
  id: string;
  business: { connectionId: string };
}): Promise<number> {
  const audiences = await prisma.customAudience.findMany({
    where: {
      adAccountId: account.id,
      approximateCount: { gte: OVERLAP_MIN_AUDIENCE_SIZE },
    },
    orderBy: { syncedAt: "desc" },
    select: {
      metaAudienceId: true,
      name: true,
      approximateCount: true,
      subtype: true,
    },
    take: OVERLAP_ANCHORS + OVERLAP_COMPARES,
  });
  if (audiences.length < 2) return 0;

  // Meta refuses to compare some subtypes (LOOKALIKE etc.) — skip them
  // as anchors but still allow them as comparison targets.
  const anchors = audiences
    .filter((a) => a.subtype !== "LOOKALIKE")
    .slice(0, OVERLAP_ANCHORS);

  const latest = await prisma.insightsSnapshot.findFirst({
    where: { adAccountId: account.id, level: "campaign" },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const forDate = latest?.date ?? new Date();

  let written = 0;
  for (const anchor of anchors) {
    const comparisons = audiences
      .filter((a) => a.metaAudienceId !== anchor.metaAudienceId)
      .slice(0, OVERLAP_COMPARES);
    if (comparisons.length === 0) continue;

    let overlaps: Record<string, number> = {};
    try {
      overlaps = await metaClient.getAudienceOverlap(
        account.business.connectionId,
        anchor.metaAudienceId,
        comparisons.map((c) => c.metaAudienceId),
      );
    } catch {
      // Meta rejects some audiences (e.g. value-based lookalikes); skip
      // this anchor rather than failing the whole account scan.
      continue;
    }

    for (const cmp of comparisons) {
      const overlapUsers = overlaps[cmp.metaAudienceId];
      if (!overlapUsers || !anchor.approximateCount) continue;
      const pct = overlapUsers / anchor.approximateCount;
      if (pct < OVERLAP_THRESHOLD) continue;

      // Stable composite id so re-running the scan upserts in place.
      const pairKey = [anchor.metaAudienceId, cmp.metaAudienceId]
        .sort()
        .join("|");
      const pairName = `${anchor.name} ∩ ${cmp.name}`;

      const body = `Estimated ${overlapUsers.toLocaleString()} users in common (~${Math.round(pct * 100)}% of "${anchor.name}"). When two ad-sets target overlapping audiences, Meta serves both ad-sets to the same users — driving frequency up and unique reach down, which usually shows as rising CPM. Consider excluding "${cmp.name}" from any ad-set targeting "${anchor.name}", or merging the two audiences.`;

      await prisma.alert.upsert({
        where: {
          adAccountId_forDate_kind_entityId: {
            adAccountId: account.id,
            forDate,
            kind: "audience_overlap_high",
            entityId: pairKey,
          },
        },
        create: {
          adAccountId: account.id,
          forDate,
          kind: "audience_overlap_high",
          entityType: "audience_pair",
          entityId: pairKey,
          entityName: pairName,
          severity: pct >= 0.5 ? "high" : "medium",
          title: `${pairName} — ${Math.round(pct * 100)}% overlap`,
          body,
          metrics: {
            overlapUsers,
            anchorSize: anchor.approximateCount,
            overlapPct: pct,
          } as Prisma.InputJsonValue,
        },
        update: {
          severity: pct >= 0.5 ? "high" : "medium",
          title: `${pairName} — ${Math.round(pct * 100)}% overlap`,
          body,
          entityName: pairName,
          metrics: {
            overlapUsers,
            anchorSize: anchor.approximateCount,
            overlapPct: pct,
          } as Prisma.InputJsonValue,
        },
      });
      written++;
    }
  }
  return written;
}
