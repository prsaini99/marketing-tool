/**
 * Generate a CampaignPlan from a natural-language brief.
 *
 * The model never touches Meta. It produces a plan object, which is
 * validated, repaired once, and handed back for a human to approve. See
 * src/lib/campaign-plan.ts for why the plan is an object rather than a
 * sequence of write tool calls.
 *
 * GROUNDING BEATS INSTRUCTION. Nearly every way a generated plan goes wrong
 * is the model inventing an id: a pixel that does not exist, an audience from
 * another account, an image hash it made up. So the prompt carries the real
 * inventory of the account (audiences, pixels, page, library assets) and the
 * model is told to choose only from it. Anything outside that list fails
 * validation against the plan schema before it can reach a create call.
 *
 * The repair pass exists because validatePlan returns every issue at once.
 * One extra round trip fixes an entire plan, which is much cheaper than
 * either failing to the user or letting the model discover the rules by
 * having Meta reject objects one at a time.
 */

import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/llm/chat";
import { HUMAN_STYLE_RULES } from "@/lib/llm/style";
import { PLAN_JSON_SCHEMA } from "./plan-schema";
import {
  planDailySpendCents,
  planIsExecutable,
  validatePlan,
  type CampaignPlan,
  type PlanIssue,
} from "@/lib/campaign-plan";

/**
 * Meta's daily minimum is currency dependent and roughly the equivalent of
 * one US dollar. These cover the currencies this tool has seen; anything
 * else falls back to the USD figure, which is the safe direction because a
 * too-high floor produces a clear error rather than a Meta rejection.
 */
const MIN_DAILY_BUDGET_CENTS: Record<string, number> = {
  INR: 80_00,
  USD: 1_00,
  GBP: 1_00,
  EUR: 1_00,
  AED: 4_00,
  SGD: 2_00,
};

/**
 * Default ceiling on daily spend a single plan may commit, per currency.
 * Deliberately conservative. A buyer who genuinely wants to commit more can
 * raise it explicitly, which is a decision someone makes rather than a
 * decimal point the model slipped.
 */
const DEFAULT_MAX_DAILY_SPEND_CENTS: Record<string, number> = {
  INR: 50_000_00,
  USD: 600_00,
  GBP: 500_00,
  EUR: 550_00,
};

export interface PlanCampaignInput {
  /** Local MetaAdAccount id. */
  adAccountId: string;
  /** What the strategist typed. */
  brief: string;
  /** Prior turns, so "make the second one broader" resolves. */
  priorPlan?: CampaignPlan;
  /** Override the spend ceiling, in cents. Requires a deliberate act. */
  maxDailySpendCents?: number;
}

export interface PlanCampaignResult {
  plan: CampaignPlan;
  issues: PlanIssue[];
  executable: boolean;
  dailySpendCents: number;
  currency: string;
  /** True when the first attempt failed validation and was repaired. */
  repaired: boolean;
}

/** The inventory the model may choose from. Nothing outside it is valid. */
interface AccountContext {
  metaAdAccountId: string;
  accountName: string;
  currency: string;
  pageId: string | null;
  pixels: Array<{ id: string; name: string }>;
  customConversions: Array<{ id: string; name: string }>;
  audiences: Array<{ id: string; name: string; approximateCount: number | null }>;
  images: Array<{ hash: string; name: string; description: string | null }>;
  videos: Array<{ id: string; name: string; transcript: string | null }>;
  /** How much of the library the model can actually see into. */
  analysed: { images: number; videos: number };
}

async function loadAccountContext(adAccountId: string): Promise<AccountContext> {
  const acct = await prisma.metaAdAccount.findUnique({
    where: { id: adAccountId },
    select: {
      metaAdAccountId: true,
      name: true,
      currency: true,
      business: { select: { connectionId: true } },
    },
  });
  if (!acct) throw new Error("Ad account not found");

  const [conversions, audiences, images, videos, social] = await Promise.all([
    prisma.customConversion.findMany({
      where: { adAccountId },
      select: { metaConversionId: true, name: true, eventSourceId: true },
      take: 25,
    }),
    prisma.customAudience.findMany({
      where: { adAccountId },
      select: { metaAudienceId: true, name: true, approximateCount: true },
      take: 40,
    }),
    // aiDescription and transcript are what make asset selection possible at
    // all. Without them the model sees "IMG_8580.PNG_105" and is choosing a
    // creative by filename, which is to say at random. Described assets sort
    // first so they survive the take() when a library is larger than the
    // slice, since an asset the model can actually reason about is worth
    // more prompt budget than one it cannot.
    prisma.adImage.findMany({
      where: { adAccountId },
      select: { metaImageHash: true, name: true, aiDescription: true },
      orderBy: [{ aiDescription: { sort: "desc", nulls: "last" } }, { syncedAt: "desc" }],
      take: 30,
    }),
    prisma.adVideo.findMany({
      where: { adAccountId, status: "ready" },
      select: { metaVideoId: true, title: true, transcript: true },
      orderBy: [{ transcript: { sort: "desc", nulls: "last" } }, { syncedAt: "desc" }],
      take: 30,
    }),
    prisma.socialAccount.findFirst({
      where: { connection: { id: acct.business.connectionId } },
      select: { linkedPageId: true },
    }),
  ]);

  // Pixels are not mirrored (see src/app/api/pixels/route.ts, which proxies
  // Meta live). Rather than adding a Meta round trip to plan generation,
  // derive them from the custom conversions we do mirror: eventSourceId is
  // the pixel that conversion fires on. This only surfaces pixels that have
  // at least one saved conversion, which is the honest limit. A pixel with
  // no conversions is one the model has no business targeting anyway,
  // because it would have nothing to name as the event.
  const pixelIds = [
    ...new Set(conversions.map((c) => c.eventSourceId).filter(Boolean)),
  ] as string[];

  return {
    metaAdAccountId: acct.metaAdAccountId,
    accountName: acct.name ?? "",
    currency: acct.currency ?? "USD",
    pageId: social?.linkedPageId ?? null,
    pixels: pixelIds.map((id) => ({
      id,
      name:
        conversions.find((c) => c.eventSourceId === id)?.name ??
        "pixel behind a saved conversion",
    })),
    customConversions: conversions.map((c) => ({
      id: c.metaConversionId,
      name: c.name ?? "",
    })),
    audiences: audiences.map((a) => ({
      id: a.metaAudienceId,
      name: a.name ?? "",
      approximateCount: a.approximateCount ?? null,
    })),
    images: images.map((i) => ({
      hash: i.metaImageHash,
      name: i.name ?? "",
      description: i.aiDescription,
    })),
    videos: videos.map((v) => ({
      id: v.metaVideoId,
      name: v.title ?? "",
      transcript: v.transcript,
    })),
    analysed: {
      images: images.filter((i) => i.aiDescription).length,
      videos: videos.filter((v) => v.transcript).length,
    },
  };
}

const PLAN_SCHEMA = {
  name: "campaign_plan",
  // See plan-schema.ts for why this is not strict-mode.
  strict: false,
  schema: PLAN_JSON_SCHEMA,
} as const;

function systemPrompt(ctx: AccountContext, maxDailyCents: number): string {
  const list = <T,>(items: T[], render: (t: T) => string, empty: string) =>
    items.length ? items.map(render).join("\n") : empty;

  return `You are a senior Meta media buyer drafting a campaign for a colleague to review. You produce a plan. You do not launch anything, and a human approves every plan before it reaches Meta.

ACCOUNT
${ctx.accountName} (${ctx.metaAdAccountId}), currency ${ctx.currency}.
${ctx.pageId ? `Linked Page id: ${ctx.pageId}` : "No linked Page recorded."}

YOU MAY ONLY REFERENCE IDS FROM THESE LISTS. Never invent an id, a hash, or an audience name. If the brief needs something that is not here, leave the field out and say so in the rationale.

Audiences:
${list(ctx.audiences, (a) => `- ${a.id} "${a.name}"${a.approximateCount ? ` (~${a.approximateCount.toLocaleString()} people)` : ""}`, "- none")}

Pixels:
${list(ctx.pixels, (p) => `- ${p.id} "${p.name}"`, "- none")}

Custom conversions:
${list(ctx.customConversions, (c) => `- ${c.id} "${c.name}"`, "- none")}

Library images (use imageHash). A description means the image has been analysed and you know what is in it. A bare filename means it has not, so choosing it is a guess:
${list(ctx.images, (i) => `- ${i.hash} "${i.name}"${i.description ? `\n    shows: ${i.description.replace(/\s+/g, " ").slice(0, 220)}` : ""}`, "- none")}

Library videos (use videoId). A transcript means the audio has been analysed:
${list(ctx.videos, (v) => `- ${v.id} "${v.name}"${v.transcript ? `\n    says: ${v.transcript.replace(/\s+/g, " ").slice(0, 220)}` : ""}`, "- none")}

ASSET SELECTION: prefer an asset whose description or transcript actually matches the brief. If nothing matches, say so in the rationale and pick the closest described asset rather than an undescribed one. Never claim in ad copy that a creative shows something its description does not.

STRUCTURAL RULES, which Meta enforces and rejects with unhelpful messages:
- Budget lives EITHER on the campaign (campaign budget optimisation on) OR on every ad set, never both and never neither.
- A lifetime budget requires a stop time on the campaign, or an end time on the ad set.
- optimizationGoal must be compatible with the campaign objective.
- OFFSITE_CONVERSIONS, VALUE, LEAD_GENERATION and APP_INSTALLS each need a promotedObject naming what to count. A pixel needs an event type. A pixel and a custom conversion are mutually exclusive.
- CONVERSATIONS sends people into Messenger or Instagram Direct, needs the Page id in promotedObject, and its ads need no link URL.
- Ages are 13 to 65. A special ad category (HOUSING, CREDIT, EMPLOYMENT, SOCIAL_ISSUES) forbids narrowing age or gender at all: use 18 to 65 with genders null.
- All money is in CENTS of ${ctx.currency}. 2000 ${ctx.currency} per day is 200000.

BUDGET DISCIPLINE:
- This plan may commit at most ${(maxDailyCents / 100).toLocaleString()} ${ctx.currency} per day in total. Stay under it.
- Prefer fewer, better funded ad sets over many starved ones. An ad set below roughly 500 ${ctx.currency} a day rarely exits the learning phase.
- Default every campaign, ad set and ad to PAUSED status thinking: the reviewer decides when it goes live.

Write ad copy in the brand's voice if past ads are provided. Keep headlines under 40 characters.

${HUMAN_STYLE_RULES}`;
}

export async function planCampaign(
  input: PlanCampaignInput,
): Promise<PlanCampaignResult> {
  const ctx = await loadAccountContext(input.adAccountId);
  const currency = ctx.currency;
  const maxDailySpendCents =
    input.maxDailySpendCents ??
    DEFAULT_MAX_DAILY_SPEND_CENTS[currency] ??
    DEFAULT_MAX_DAILY_SPEND_CENTS.USD;
  const minDailyBudgetCents =
    MIN_DAILY_BUDGET_CENTS[currency] ?? MIN_DAILY_BUDGET_CENTS.USD;

  const validateOpts = { maxDailySpendCents, minDailyBudgetCents, currency };
  const system = systemPrompt(ctx, maxDailySpendCents);

  const userPrompt = input.priorPlan
    ? `Here is the current plan:\n\n${JSON.stringify(input.priorPlan, null, 2)}\n\nApply this change and return the FULL updated plan:\n${input.brief}`
    : `Brief:\n${input.brief}`;

  const first = await completeJson<Omit<CampaignPlan, "metaAdAccountId">>(
    userPrompt,
    { system, temperature: 0.4, maxTokens: 4000 },
    PLAN_SCHEMA as unknown as Parameters<typeof completeJson>[2],
  );

  // The account id comes from the caller's route parameter, never from the
  // model. A model-chosen account id is a cross-account write waiting to
  // happen, and it is the one field there is no reason to let it pick.
  let plan: CampaignPlan = { ...first, metaAdAccountId: ctx.metaAdAccountId };
  let issues = validatePlan(plan, validateOpts);
  let repaired = false;

  if (!planIsExecutable(issues)) {
    repaired = true;
    const errorList = issues
      .filter((i) => i.severity === "error")
      .map((i) => `- ${i.path}: ${i.message}`)
      .join("\n");

    const second = await completeJson<Omit<CampaignPlan, "metaAdAccountId">>(
      `This plan failed validation:\n\n${JSON.stringify(plan, null, 2)}\n\nProblems:\n${errorList}\n\nReturn the FULL corrected plan. Change only what the problems require.`,
      { system, temperature: 0.2, maxTokens: 4000 },
      PLAN_SCHEMA as unknown as Parameters<typeof completeJson>[2],
    );
    const candidate: CampaignPlan = {
      ...second,
      metaAdAccountId: ctx.metaAdAccountId,
    };
    const candidateIssues = validatePlan(candidate, validateOpts);
    // Keep the repair only if it is genuinely better. A second attempt that
    // trades three errors for four is not a repair, and silently accepting
    // it would make the feature feel random.
    const before = issues.filter((i) => i.severity === "error").length;
    const after = candidateIssues.filter((i) => i.severity === "error").length;
    if (after < before) {
      plan = candidate;
      issues = candidateIssues;
    }
  }

  return {
    plan,
    issues,
    executable: planIsExecutable(issues),
    dailySpendCents: planDailySpendCents(plan),
    currency,
    repaired,
  };
}
