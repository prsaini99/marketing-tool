/**
 * Pre-flight scoring — pure module, no I/O.
 *
 * Turns a set of individual check results into one number and one verdict.
 * Kept separate from the checks themselves (which call the LLM, pgvector and
 * Postgres) so the scoring rules can be reasoned about and tested directly:
 * how a score is composed is a product decision that will be argued over,
 * and it should not require an OpenAI key to change.
 *
 * THE SKIPPED RULE is the important one. A check that could not run —
 * because the account has no indexed history, or the classifier was
 * unavailable — is EXCLUDED from the score rather than counted as a pass or
 * a fail. Counting it as a pass inflates a draft nobody actually checked;
 * counting it as a fail punishes a new account for being new. Both make the
 * number dishonest in a way the user cannot see, so the denominator shrinks
 * instead, and the UI reports how many checks actually ran.
 */

export type CheckStatus = "pass" | "warn" | "fail" | "skipped";

export interface PreflightCheck {
  /** Stable slug — the UI keys off this, so never rename casually. */
  id: string;
  title: string;
  status: CheckStatus;
  /** One-sentence, human-readable result. Always populated. */
  detail: string;
  /** Optional supporting numbers/strings the UI can render as evidence. */
  evidence?: string[];
  /**
   * Relative importance. A policy violation gets the ad rejected by Meta;
   * a fatigue warning is advisory. Weighting them equally would let a
   * serious problem hide behind three cosmetic passes.
   */
  weight: number;
}

export const CHECK_WEIGHTS = {
  policy: 3,
  performance: 2,
  fatigue: 1,
  link: 1,
} as const;

/** pass = full marks, warn = partial, fail = zero. */
const STATUS_SCORE: Record<Exclude<CheckStatus, "skipped">, number> = {
  pass: 100,
  warn: 55,
  fail: 0,
};

export type Verdict = "ready" | "review" | "blocked";

export interface PreflightSummary {
  /** 0–100, or null when no check could run at all. */
  score: number | null;
  verdict: Verdict;
  checksRun: number;
  checksSkipped: number;
  headline: string;
}

/**
 * Weighted mean over the checks that actually ran.
 *
 * Any single `fail` forces the verdict to "blocked" regardless of score —
 * a draft that will be rejected by Meta is not "82% ready", it is not
 * shippable, and a high average from unrelated passes must not paper over
 * that.
 */
export function summarize(checks: PreflightCheck[]): PreflightSummary {
  const ran = checks.filter((c) => c.status !== "skipped");
  const skipped = checks.length - ran.length;

  if (ran.length === 0) {
    return {
      score: null,
      verdict: "review",
      checksRun: 0,
      checksSkipped: skipped,
      headline: "No checks could run",
    };
  }

  const totalWeight = ran.reduce((s, c) => s + c.weight, 0);
  const weighted = ran.reduce(
    (s, c) => s + STATUS_SCORE[c.status as Exclude<CheckStatus, "skipped">] * c.weight,
    0,
  );
  const score = totalWeight > 0 ? Math.round(weighted / totalWeight) : null;

  const hasFail = ran.some((c) => c.status === "fail");
  const hasWarn = ran.some((c) => c.status === "warn");

  const verdict: Verdict = hasFail ? "blocked" : hasWarn ? "review" : "ready";

  const headline = hasFail
    ? "Fix before launching"
    : hasWarn
      ? "Worth a look before launching"
      : "Looks good to launch";

  return {
    score,
    verdict,
    checksRun: ran.length,
    checksSkipped: skipped,
    headline,
  };
}

/**
 * Link sanity — pure, so it lives here rather than in the service.
 *
 * Deliberately shallow: this does not fetch the URL. A pre-flight check that
 * makes an outbound request to a customer's landing page on every keystroke
 * is a good way to look like a bot to their WAF. Shape only.
 */
export function checkLink(url: string | null | undefined): PreflightCheck {
  const base = {
    id: "link",
    title: "Destination link",
    weight: CHECK_WEIGHTS.link,
  };

  const value = (url ?? "").trim();
  if (!value) {
    return {
      ...base,
      status: "fail",
      detail: "No destination URL. The ad has nowhere to send clicks.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ...base,
      status: "fail",
      detail: `"${value}" is not a valid URL.`,
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ...base,
      status: "fail",
      detail: `Unsupported protocol "${parsed.protocol}". Use https.`,
    };
  }

  if (parsed.protocol === "http:") {
    return {
      ...base,
      status: "warn",
      detail: "Link uses http, not https. Browsers will flag it as insecure.",
    };
  }

  const evidence: string[] = [];
  const hasUtm = parsed.searchParams.has("utm_source");
  if (!hasUtm) {
    evidence.push("No utm_source, so this traffic will be hard to attribute.");
    return {
      ...base,
      status: "warn",
      detail: "Valid https link, but no UTM tagging.",
      evidence,
    };
  }

  return {
    ...base,
    status: "pass",
    detail: "Valid https link with UTM tagging.",
  };
}

/**
 * Turn similar past ads into a predicted-performance check.
 *
 * `comparables` are prior creatives from THIS account that both look like the
 * draft and actually spent money. Ads with no spend are excluded by the
 * caller — an ad that never ran predicts nothing, and including it would
 * quietly drag every estimate toward zero.
 */
export function checkPredictedPerformance(
  comparables: Array<{ cpaCents: number | null; spendCents: number }>,
  currencySymbol = "₹",
): PreflightCheck {
  const base = {
    id: "performance",
    title: "Predicted performance",
    weight: CHECK_WEIGHTS.performance,
  };

  const withCpa = comparables.filter(
    (c): c is { cpaCents: number; spendCents: number } =>
      typeof c.cpaCents === "number" && c.cpaCents > 0,
  );

  if (withCpa.length === 0) {
    return {
      ...base,
      status: "skipped",
      detail:
        "No comparable ads with delivery data in this account yet. Nothing to predict from.",
    };
  }

  const cpas = withCpa.map((c) => c.cpaCents).sort((a, b) => a - b);
  const low = cpas[0];
  const high = cpas[cpas.length - 1];
  const median = cpas[Math.floor(cpas.length / 2)];

  const fmt = (cents: number) =>
    `${currencySymbol}${Math.round(cents / 100).toLocaleString()}`;

  const evidence = [
    `Based on ${withCpa.length} similar ad${withCpa.length === 1 ? "" : "s"} with delivery data.`,
    `Range ${fmt(low)}-${fmt(high)}, median ${fmt(median)}.`,
  ];

  // With very few comparables this is an anecdote, not a prediction. Say so
  // rather than dressing up n=1 as a forecast.
  if (withCpa.length < 3) {
    return {
      ...base,
      status: "warn",
      detail: `Thin evidence: only ${withCpa.length} comparable ad${withCpa.length === 1 ? " has" : "s have"} delivery data. Median CPA ${fmt(median)}.`,
      evidence,
    };
  }

  return {
    ...base,
    status: "pass",
    detail: `Similar ads in this account run around ${fmt(median)} CPA.`,
    evidence,
  };
}

/**
 * Creative fatigue — how crowded is this hook already?
 *
 * `sameHookActive` counts ACTIVE ads in the account already using the
 * draft's hook type. Thresholds are deliberately generous: the goal is to
 * catch "you now have twelve ads with the same opening", not to discourage
 * a second one.
 */
export function checkFatigue(
  hookLabel: string | null,
  sameHookActive: number,
  totalActive: number,
): PreflightCheck {
  const base = {
    id: "fatigue",
    title: "Creative fatigue",
    weight: CHECK_WEIGHTS.fatigue,
  };

  if (!hookLabel) {
    return {
      ...base,
      status: "skipped",
      detail: "Could not classify this draft's hook, so fatigue is unknown.",
    };
  }

  if (totalActive === 0) {
    return {
      ...base,
      status: "skipped",
      detail: "No active ads in this account to compare against.",
    };
  }

  const share = sameHookActive / totalActive;
  // Phrasing avoids an indefinite article before the label on purpose:
  // labels are data ("Offer", "Other", "How-to"), so "a"/"an" would need a
  // vowel rule that gets it wrong on the next label someone adds. "the
  // <label> hook" is correct for every value.
  const evidence = [
    sameHookActive === 1
      ? `1 of ${totalActive} active ads already uses the "${hookLabel}" hook.`
      : `${sameHookActive} of ${totalActive} active ads already use the "${hookLabel}" hook.`,
  ];

  if (sameHookActive >= 5 && share >= 0.5) {
    return {
      ...base,
      status: "warn",
      detail: `Most of this account's live ads already use the "${hookLabel}" hook, so diversity is thin.`,
      evidence,
    };
  }

  if (sameHookActive === 0) {
    return {
      ...base,
      status: "pass",
      detail: `No live ads use the "${hookLabel}" hook. This adds variety.`,
    };
  }

  return {
    ...base,
    status: "pass",
    detail: `The "${hookLabel}" hook is not over-represented here.`,
    evidence,
  };
}
