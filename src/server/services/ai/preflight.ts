/**
 * Pre-flight — score an ad draft BEFORE it reaches Meta.
 *
 * This is the check nobody else in the category can run. Ad-spy tools see
 * competitors' published ads but never your draft; analytics tools see your
 * results but only after you have spent the money. Sitting inside the create
 * flow, with the account's own indexed history behind it, is what makes
 * "similar ads in this account run around ₹400 CPA" a sentence this tool can
 * say at the moment it is still useful — before launch.
 *
 * Four checks, run CONCURRENTLY because they are independent and the user is
 * waiting on a form:
 *   policy      — LLM scan for Meta ad-policy risk (heaviest weight: a
 *                 rejection costs days)
 *   performance — nearest-neighbour search over this account's creatives,
 *                 restricted to ones that actually spent money
 *   fatigue     — classify the draft's hook, count live ads sharing it
 *   link        — pure shape check (no outbound request; see lib/preflight)
 *
 * EVERY CHECK FAILS SOFT. A pre-flight panel that 500s blocks the create
 * flow it is supposed to assist, so an unavailable check degrades to
 * "skipped" and is excluded from the score rather than failing the request.
 * The user can always still launch — this advises, it does not gate.
 */

import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/llm/chat";
import { search } from "@/server/services/rag";
import {
  checkFatigue,
  checkLink,
  checkPredictedPerformance,
  CHECK_WEIGHTS,
  summarize,
  type PreflightCheck,
  type PreflightSummary,
} from "@/lib/preflight";
import {
  buildClassifyPrompt,
  coerceTags,
  CREATIVE_TAGS_SCHEMA,
  HOOK_LABELS,
  type HookType,
} from "@/lib/creative-taxonomy";

export interface PreflightInput {
  /** Local MetaAdAccount.id OR the Meta act_ id — both are accepted. */
  adAccountId: string;
  primaryText?: string;
  headline?: string;
  description?: string;
  callToAction?: string;
  linkUrl?: string;
  /**
   * Whether the destination link is part of what's being proposed.
   *
   * True (default) for a new ad draft: the operator is choosing the URL, so
   * a missing one is a real defect — the ad would have nowhere to send
   * clicks. False when the link is INHERITED from an existing ad, as in the
   * improve-this-ad flow: there, a missing URL means our local mirror never
   * captured the creative's link, not that the live ad lacks one. Failing on
   * that would report a gap in our own data as a fault in the client's ad,
   * and it would block a rewrite that never touched the link.
   */
  linkIsProposed?: boolean;
}

export interface PreflightResult {
  summary: PreflightSummary;
  checks: PreflightCheck[];
}

const POLICY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["risk", "reason", "issues"],
  properties: {
    risk: { type: "string", enum: ["none", "low", "high"] },
    reason: {
      type: "string",
      description: "One sentence explaining the verdict, in plain English.",
    },
    issues: {
      type: "array",
      items: { type: "string" },
      description:
        "Specific phrases from the ad that create risk, quoted verbatim. Empty when risk is none.",
    },
  },
} as const;

const POLICY_SYSTEM = [
  "You review advertising copy against Meta's advertising policies.",
  "You are a screening step before submission, not the final arbiter.",
  "Flag only what Meta actually enforces: personal attributes (implying you",
  "know the reader's race, health, finances, sexual orientation), unrealistic",
  "outcome claims, before/after body imagery language, guaranteed financial",
  "returns, misleading urgency, prohibited products, and unsubstantiated",
  "superlatives or health claims.",
  "Do NOT flag ordinary marketing language, ordinary discounts, or a confident tone.",
  "Prefer 'none' when nothing concrete applies. Over-flagging trains people to ignore you.",
].join(" ");

function draftText(input: PreflightInput): string {
  return [
    input.headline ? `Headline: ${input.headline.trim()}` : "",
    input.primaryText ? `Primary text: ${input.primaryText.trim()}` : "",
    input.description ? `Description: ${input.description.trim()}` : "",
    input.callToAction ? `CTA: ${input.callToAction}` : "",
    input.linkUrl ? `URL: ${input.linkUrl.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Resolve either id form to the local account row. */
async function resolveAccount(idOrMetaId: string) {
  const byId = await prisma.metaAdAccount.findUnique({
    where: { id: idOrMetaId },
    select: { id: true, currency: true, businessId: true },
  });
  if (byId) return byId;

  const metaAdAccountId = idOrMetaId.startsWith("act_")
    ? idOrMetaId
    : `act_${idOrMetaId}`;
  return prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId },
    select: { id: true, currency: true, businessId: true },
  });
}

function currencySymbol(currency: string): string {
  if (currency === "INR") return "₹";
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  if (currency === "GBP") return "£";
  return "";
}

async function runPolicyCheck(text: string): Promise<PreflightCheck> {
  const base = {
    id: "policy",
    title: "Meta policy",
    weight: CHECK_WEIGHTS.policy,
  };
  try {
    const out = await completeJson<{
      risk?: string;
      reason?: string;
      issues?: string[];
    }>(
      `Review this ad draft:\n\n${text}`,
      {
        model: "gpt-4o-mini",
        temperature: 0,
        maxTokens: 512,
        system: POLICY_SYSTEM,
      },
      { name: "policy_review", schema: POLICY_SCHEMA as unknown as Record<string, unknown> },
    );

    const issues = Array.isArray(out.issues) ? out.issues.slice(0, 5) : [];
    const reason = (out.reason ?? "").trim();

    if (out.risk === "high") {
      return {
        ...base,
        status: "fail",
        detail: reason || "Likely to be rejected by Meta.",
        evidence: issues,
      };
    }
    if (out.risk === "low") {
      return {
        ...base,
        status: "warn",
        detail: reason || "Some wording may attract review.",
        evidence: issues,
      };
    }
    return {
      ...base,
      status: "pass",
      detail: reason || "No obvious policy problems.",
    };
  } catch (e) {
    console.error("[preflight] policy check failed:", e);
    return {
      ...base,
      status: "skipped",
      detail: "Policy check unavailable right now.",
    };
  }
}

/**
 * Nearest-neighbour search over this account's own creatives.
 *
 * Only creatives WITH spend become comparables — an ad that never ran
 * predicts nothing, and including it would drag every estimate toward zero
 * while looking like evidence.
 */
async function runPerformanceCheck(
  text: string,
  adAccountId: string,
  symbol: string,
): Promise<PreflightCheck> {
  try {
    const hits = await search({
      query: text,
      namespace: "ads",
      adAccountId,
      topK: 12,
    });

    const comparables = hits
      .map((h) => {
        const md = h.metadata ?? {};
        const spendCents = Number(md.spendCents ?? 0);
        const conversions = Number(md.conversionsCount ?? 0);
        return {
          spendCents,
          cpaCents:
            conversions > 0 ? Math.round(spendCents / conversions) : null,
        };
      })
      .filter((c) => c.spendCents > 0);

    return checkPredictedPerformance(comparables, symbol);
  } catch (e) {
    console.error("[preflight] performance check failed:", e);
    return {
      id: "performance",
      title: "Predicted performance",
      weight: CHECK_WEIGHTS.performance,
      status: "skipped",
      detail: "Could not compare against past ads right now.",
    };
  }
}

/**
 * Classify the draft's hook, then count how many ACTIVE ads in the account
 * already use it.
 *
 * "Active" is the right denominator, not "all creatives ever": fatigue is
 * about what a customer could see right now, and an archived ad from March
 * contributes nothing to that.
 */
async function runFatigueCheck(
  text: string,
  adAccountId: string,
): Promise<PreflightCheck> {
  try {
    const out = await completeJson<{ results?: unknown[] }>(
      buildClassifyPrompt([{ id: "draft", content: text }]),
      {
        model: "gpt-4o-mini",
        temperature: 0,
        maxTokens: 512,
        system:
          "You label advertising creatives into a fixed taxonomy. You are precise, literal, and never invent labels outside the allowed values.",
      },
      { name: "creative_tags", schema: CREATIVE_TAGS_SCHEMA as unknown as Record<string, unknown> },
    );
    const tags = coerceTags((out.results ?? [])[0]);
    const hookLabel = HOOK_LABELS[tags.hookType as HookType] ?? null;

    // Active ads in this account, mapped to their creative ids, so we can
    // look up the hook tag each one carries.
    const activeAds = await prisma.ad.findMany({
      where: {
        adAccountId,
        status: "ACTIVE",
        metaCreativeId: { not: null },
      },
      select: { metaCreativeId: true },
    });
    const activeCreativeIds = activeAds
      .map((a) => a.metaCreativeId)
      .filter((id): id is string => Boolean(id));

    if (activeCreativeIds.length === 0) {
      return checkFatigue(hookLabel, 0, 0);
    }

    const tagged = (await prisma.embedding.findMany({
      where: {
        namespace: "ads",
        sourceType: "AdCreative",
        adAccountId,
        sourceId: { in: activeCreativeIds },
      },
      select: { metadata: true },
    })) as unknown as Array<{ metadata: Record<string, unknown> | null }>;

    const sameHook = tagged.filter(
      (t) => (t.metadata ?? {}).hookType === tags.hookType,
    ).length;

    return checkFatigue(hookLabel, sameHook, tagged.length);
  } catch (e) {
    console.error("[preflight] fatigue check failed:", e);
    return {
      id: "fatigue",
      title: "Creative fatigue",
      weight: CHECK_WEIGHTS.fatigue,
      status: "skipped",
      detail: "Could not classify this draft right now.",
    };
  }
}

export async function runPreflight(
  input: PreflightInput,
): Promise<PreflightResult> {
  const account = await resolveAccount(input.adAccountId);
  if (!account) throw new Error("Ad account not found");

  const text = draftText(input);

  // Measure the COPY, not the formatted block. `draftText` prefixes each
  // field with a label ("Headline: " is 10 characters on its own), so a
  // length check against the formatted string passes for any non-empty
  // input — a one-word headline would sail through and spend two LLM calls
  // scoring nothing.
  const copyLength = [input.headline, input.primaryText, input.description]
    .map((s) => (s ?? "").trim())
    .join(" ")
    .trim().length;
  if (copyLength < 15) {
    throw new Error("Not enough ad copy to check yet");
  }

  const symbol = currencySymbol(account.currency);

  // Independent checks, so run them together — this sits in front of a user
  // staring at a form, and serial LLM calls would triple the wait.
  const [policy, performance, fatigue] = await Promise.all([
    runPolicyCheck(text),
    runPerformanceCheck(text, account.id, symbol),
    runFatigueCheck(text, account.id),
  ]);

  const checks = [policy, performance, fatigue];

  // An inherited link with nothing mirrored is not a finding — omit the
  // check entirely rather than reporting a pass it hasn't earned. summarize()
  // handles a shorter check list, and the panel reports how many ran.
  const linkIsProposed = input.linkIsProposed !== false;
  if (linkIsProposed || input.linkUrl) {
    checks.push(checkLink(input.linkUrl));
  }

  return { summary: summarize(checks), checks };
}
