/**
 * The campaign copilot, as an agent.
 *
 * The model explores the account through read-only tools in a loop, then
 * commits once by calling submit_plan. That plan goes through validatePlan
 * exactly as before, and a failed validation is fed back so the agent can
 * repair it inside the same conversation rather than handing a broken plan
 * to a human.
 *
 * WHY THE LOOP DOES NOT GET WRITE TOOLS
 *
 * An agent holding create_campaign / create_adset / create_ad would leave a
 * half-built campaign on Meta the first time its fifth call failed, and it
 * would ask a media buyer to approve fourteen separate actions instead of
 * one shape. Exploration genuinely wants a loop. Commitment wants an
 * artefact you can price, validate and reject as a unit. So the loop is
 * read-only and submit_plan is terminal.
 *
 * The spend ceiling and the pinned-asset constraint survive intact because
 * they run against the submitted plan, in code, after the model is done.
 * That is the whole reason this is not simply "let the agent do it".
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { prisma } from "@/lib/db/prisma";
import { HUMAN_STYLE_RULES } from "@/lib/llm/style";
import { DEFAULT_MODEL } from "@/lib/llm/chat";
import {
  planDailySpendCents,
  planIsExecutable,
  validatePlan,
  type CampaignPlan,
  type PlanIssue,
  type ValidateOptions,
} from "@/lib/campaign-plan";
import { COPILOT_TOOLS, runCopilotTool, type ToolContext } from "./copilot-tools";
import { PLAN_JSON_SCHEMA } from "./plan-schema";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey && process.env.NODE_ENV === "production") {
  console.error("[copilot] OPENAI_API_KEY is not set");
}
const openai = new OpenAI({ apiKey: apiKey ?? "missing-key" });

/**
 * Tool calls before we stop. Exploration is a handful of lookups; anything
 * approaching this many is a model going in circles, and the cap keeps a
 * misbehaving conversation from draining the API budget.
 */
const MAX_ITERATIONS = 10;

/** Validation round trips. One repair is normal, three is a model that will not converge. */
const MAX_REPAIRS = 2;

const MIN_DAILY_BUDGET_CENTS: Record<string, number> = {
  INR: 80_00, USD: 1_00, GBP: 1_00, EUR: 1_00, AED: 4_00, SGD: 2_00,
};
const DEFAULT_MAX_DAILY_SPEND_CENTS: Record<string, number> = {
  INR: 50_000_00, USD: 600_00, GBP: 500_00, EUR: 550_00,
};

export interface CopilotInput {
  adAccountId: string;
  brief: string;
  priorPlan?: CampaignPlan;
  maxDailySpendCents?: number;
  /** Assets the operator pinned. Enforced as a hard constraint. */
  pinnedImageHashes?: string[];
  pinnedVideoIds?: string[];
}

/** One thing the agent did, surfaced so the user can see its reasoning. */
export interface AgentStep {
  tool: string;
  summary: string;
}

export interface CopilotResult {
  plan: CampaignPlan | null;
  issues: PlanIssue[];
  /**
   * The exact options the plan was validated against.
   *
   * Returned so the browser can re-run validatePlan on an edited plan and
   * get identical answers. validatePlan is pure, so live validation while
   * someone edits costs no round trip; sending the options rather than
   * letting the client reconstruct them is what stops the two drifting into
   * different spend ceilings or budget floors.
   */
  validateOptions: ValidateOptions;
  executable: boolean;
  dailySpendCents: number;
  currency: string;
  steps: AgentStep[];
  /** Set when the agent gave up without submitting anything. */
  message?: string;
}

const SUBMIT_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "submit_plan",
    description:
      "Submit the finished campaign plan. Call this exactly once, after you have looked up whatever you need. The plan is validated and shown to a human for approval; nothing is created on Meta.",
    parameters: PLAN_JSON_SCHEMA,
  },
};

export async function runCopilot(input: CopilotInput): Promise<CopilotResult> {
  const account = await prisma.metaAdAccount.findUnique({
    where: { id: input.adAccountId },
    select: {
      metaAdAccountId: true,
      name: true,
      currency: true,
      business: { select: { connectionId: true } },
    },
  });
  if (!account) throw new Error("Ad account not found");

  const currency = account.currency ?? "USD";
  const maxDailySpendCents =
    input.maxDailySpendCents ??
    DEFAULT_MAX_DAILY_SPEND_CENTS[currency] ??
    DEFAULT_MAX_DAILY_SPEND_CENTS.USD;
  const validateOpts = {
    maxDailySpendCents,
    minDailyBudgetCents: MIN_DAILY_BUDGET_CENTS[currency] ?? MIN_DAILY_BUDGET_CENTS.USD,
    currency,
    pinnedImageHashes: input.pinnedImageHashes,
    pinnedVideoIds: input.pinnedVideoIds,
  };

  const page = await prisma.socialAccount.findFirst({
    where: { connection: { id: account.business.connectionId } },
    select: { linkedPageId: true },
  });

  const ctx: ToolContext = {
    adAccountId: input.adAccountId,
    metaAdAccountId: account.metaAdAccountId,
    currency,
  };

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(account.name ?? "", account.metaAdAccountId, currency, maxDailySpendCents, page?.linkedPageId ?? null, input) },
    { role: "user", content: userPrompt(input) },
  ];

  const steps: AgentStep[] = [];
  let repairs = 0;
  // Set once we have told the model in no uncertain terms to submit. See the
  // no-tool-calls branch below for why prompting alone is not enough.
  let forcedSubmit = false;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const res = await openai.chat.completions.create({
      model: DEFAULT_MODEL,
      temperature: 0.3,
      max_completion_tokens: 4000,
      messages,
      tools: [...COPILOT_TOOLS, SUBMIT_TOOL],
      // Once forced, the model has no option but to emit a structured plan.
      ...(forcedSubmit
        ? { tool_choice: { type: "function" as const, function: { name: "submit_plan" } } }
        : {}),
    });

    const msg = res.choices[0]?.message;
    if (!msg) break;
    const toolCalls = msg.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const prose = msg.content ?? "";

      // A model that has finished thinking very often WRITES the plan out in
      // markdown instead of calling submit_plan. Observed on the first real
      // run: it searched the library, picked a video, laid out the ad set and
      // rationale, and never called the tool. Asking again in words does not
      // reliably fix it, so force the tool choice and let it try once more.
      //
      // Length is the signal. A short reply is a genuine clarifying question
      // and deserves to reach the user verbatim; a long one is a plan in the
      // wrong format.
      if (!forcedSubmit && prose.length > 400) {
        forcedSubmit = true;
        messages.push({ role: "assistant", content: prose });
        messages.push({
          role: "user",
          content:
            "Submit that as a plan by calling submit_plan. Do not describe it in prose.",
        });
        continue;
      }

      // Genuinely a question, or it failed even when forced. Surface it
      // verbatim rather than pretending planning failed for some other reason.
      return {
        plan: null,
        issues: [],
        executable: false,
        dailySpendCents: 0,
        currency,
        validateOptions: validateOpts,
        steps,
        message: prose || "The copilot did not produce a plan.",
      };
    }

    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      const { name, arguments: rawArgs } = call.function;

      if (name === "submit_plan") {
        let submitted: CampaignPlan;
        try {
          const parsed = JSON.parse(rawArgs || "{}") as Omit<CampaignPlan, "metaAdAccountId">;
          // The account id comes from the caller, never the model. A
          // model-chosen account id is a cross-account write waiting to
          // happen, and it is the one field there is no reason to let it pick.
          submitted = { ...parsed, metaAdAccountId: account.metaAdAccountId };
        } catch {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: "The plan was not valid JSON. Submit it again.",
          });
          continue;
        }

        const issues = validatePlan(submitted, validateOpts);
        if (planIsExecutable(issues) || repairs >= MAX_REPAIRS) {
          steps.push({ tool: "submit_plan", summary: "Submitted the plan" });
          return {
            plan: submitted,
            issues,
            executable: planIsExecutable(issues),
            dailySpendCents: planDailySpendCents(submitted),
            currency,
            validateOptions: validateOpts,
            steps,
          };
        }

        // Feed every error back at once. One round trip fixes a whole plan;
        // handing them back one at a time costs as many turns as the model
        // made mistakes.
        repairs++;
        steps.push({
          tool: "submit_plan",
          summary: `Plan rejected, ${issues.filter((i) => i.severity === "error").length} problems sent back`,
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            accepted: false,
            problems: issues
              .filter((i) => i.severity === "error")
              .map((i) => `${i.path}: ${i.message}`),
            instruction: "Fix these and call submit_plan again with the FULL plan.",
          }),
        });
        continue;
      }

      const result = await runCopilotTool(name, rawArgs, ctx);
      steps.push({ tool: name, summary: describeCall(name, rawArgs, result) });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 12_000),
      });
    }
  }

  return {
    plan: null,
    issues: [],
    executable: false,
    dailySpendCents: 0,
    currency,
    validateOptions: validateOpts,
    steps,
    message:
      "The copilot ran out of steps without settling on a plan. Try a more specific brief.",
  };
}

function describeCall(name: string, rawArgs: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  if (name === "search_creatives") {
    let q = "";
    try {
      q = String((JSON.parse(rawArgs || "{}") as { query?: string }).query ?? "");
    } catch {
      /* label only */
    }
    const n = Array.isArray(r?.matches) ? r.matches.length : 0;
    return `Searched the library for "${q}", ${n} match${n === 1 ? "" : "es"}`;
  }
  if (name === "list_audiences") {
    const n = Array.isArray(r?.audiences) ? r.audiences.length : 0;
    return `Listed ${n} saved audience${n === 1 ? "" : "s"}`;
  }
  if (name === "list_conversions") {
    const n = Array.isArray(r?.customConversions) ? r.customConversions.length : 0;
    return `Listed ${n} custom conversion${n === 1 ? "" : "s"}`;
  }
  if (name === "get_past_performance") {
    const n = Array.isArray(r?.campaigns) ? r.campaigns.length : 0;
    return n === 0
      ? "Checked past performance, no delivery in the window"
      : `Reviewed ${n} past campaign${n === 1 ? "" : "s"}`;
  }
  return name;
}

function userPrompt(input: CopilotInput): string {
  const parts: string[] = [];
  if (input.priorPlan) {
    parts.push(
      `Current plan:\n${JSON.stringify(input.priorPlan, null, 2)}\n\nApply this change and submit the FULL updated plan:`,
    );
  }
  parts.push(input.brief);
  return parts.join("\n");
}

function systemPrompt(
  accountName: string,
  metaAdAccountId: string,
  currency: string,
  maxDailyCents: number,
  pageId: string | null,
  input: CopilotInput,
): string {
  const pinned: string[] = [];
  for (const h of input.pinnedImageHashes ?? []) pinned.push(`image ${h}`);
  for (const v of input.pinnedVideoIds ?? []) pinned.push(`video ${v}`);

  return `You are a senior Meta media buyer drafting a campaign for a colleague to review. You produce a plan; a human approves it before anything reaches Meta. You never create anything yourself.

ACCOUNT
${accountName} (${metaAdAccountId}), currency ${currency}.
${pageId ? `Linked Page id: ${pageId}` : "No linked Page recorded, so a messaging destination is not available."}

HOW TO WORK
Look things up before deciding. You have tools for searching the creative library by what an asset shows or says, listing audiences and conversions, and reading how past campaigns actually performed on this account. Prefer what the account's own history suggests over generic best practice. When you are ready, call submit_plan exactly once.

NEVER INVENT AN ID. Every audience id, conversion id, pixel id, image hash and video id must come from a tool result. If the library has nothing suitable, say so in the rationale rather than making something up; the plan is validated and an unknown id is rejected.

${pinned.length ? `PINNED ASSETS, MANDATORY: the operator has pinned ${pinned.join(", ")}. Your plan MUST use every one of them, or it will be rejected. How you spread them across ad sets is your judgement: read the brief. Testing several creatives usually means one per ad set; "use these in the campaign" usually means together.\n` : ""}
STRUCTURAL RULES, which Meta enforces and rejects with unhelpful messages:
- Budget lives EITHER on the campaign (campaign budget optimisation on) OR on every ad set, never both and never neither.
- A lifetime budget requires a stop time on the campaign, or an end time on the ad set.
- optimizationGoal must be compatible with the campaign objective.
- OFFSITE_CONVERSIONS, VALUE, LEAD_GENERATION and APP_INSTALLS each need a promotedObject naming what to count. A pixel needs an event type. A pixel and a custom conversion are mutually exclusive.
- CONVERSATIONS sends people into Messenger or Instagram Direct, needs the Page id in promotedObject, and its ads need no link URL.
- Ages are 13 to 65. A special ad category (HOUSING, CREDIT, EMPLOYMENT, SOCIAL_ISSUES) forbids narrowing age or gender at all: use 18 to 65 with genders null.
- All money is in CENTS of ${currency}. 2000 ${currency} per day is 200000.

BUDGET DISCIPLINE
- This plan may commit at most ${(maxDailyCents / 100).toLocaleString()} ${currency} per day in total.
- Prefer fewer, better funded ad sets over many starved ones. An ad set below roughly 500 ${currency} a day rarely exits the learning phase.
- Everything is created paused. The reviewer decides when it goes live.

Keep headlines under 40 characters. Write copy in the brand's voice where past ads suggest one.

${HUMAN_STYLE_RULES}`;
}
