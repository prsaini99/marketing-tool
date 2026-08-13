"use client";

/**
 * Campaign copilot: brief in, reviewable plan out.
 *
 * Phase 1 deliberately has no execute button. Everything hard about this
 * feature (the plan schema, grounding the model in real account inventory,
 * the validator, the payload preview) gets built and exercised while the
 * blast radius is still zero. Wiring an executor to a plan that is already
 * trusted is the small part; trusting the plan is the large one.
 *
 * The plan tree is the product here, not the chat. A media buyer needs to see
 * three ad sets and their budgets as one object and judge it, which is
 * exactly what approving a sequence of tool calls does not give you.
 */

import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";
import type { CampaignPlan, PlanIssue } from "@/lib/campaign-plan";

interface AgentStep {
  tool: string;
  summary: string;
}

interface PlanResponse {
  /** Null when the agent asked a question instead of committing to a plan. */
  plan: CampaignPlan | null;
  issues: PlanIssue[];
  executable: boolean;
  dailySpendCents: number;
  currency: string;
  steps: AgentStep[];
  message?: string;
}

const EXAMPLES = [
  "Launch a traffic campaign for our AI automation service, 2,000 a day, India, 25 to 45, split into a broad ad set and one retargeting our website visitors.",
  "Set up a click-to-message campaign so people can DM us from the ad, 1,500 a day, engagement objective.",
  "Three ad sets testing different age bands for the saree collection, 1,000 a day each, sales objective on our purchase conversion.",
];

function money(cents: number, currency: string): string {
  return `${(cents / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })} ${currency}`;
}

/** Issues grouped under the object they belong to. */
function issuesFor(issues: PlanIssue[], prefix: string): PlanIssue[] {
  return issues.filter((i) => i.path.startsWith(prefix));
}

function IssueList({ items }: { items: PlanIssue[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {items.map((i, n) => (
        <li
          key={n}
          className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-[13px] ${
            i.severity === "error"
              ? "bg-danger-subtle text-danger"
              : "bg-warning-subtle text-warning"
          }`}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-mono text-[11px] opacity-70">
              {i.path.replace(/^adSets\[\d+\]\.?/, "")}
            </span>{" "}
            {i.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CampaignCopilot({
  adAccountId,
  accountName,
}: {
  adAccountId: string;
  accountName: string;
}) {
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlanResponse | null>(null);
  const [openSets, setOpenSets] = useState<Record<number, boolean>>({ 0: true });
  const [showPayload, setShowPayload] = useState(false);

  async function generate(refine: boolean) {
    if (!brief.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/campaign-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          adAccountId,
          brief,
          priorPlan: refine ? result?.plan : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Plan generation failed");
      setResult(data as PlanResponse);
      setOpenSets({ 0: true });
      setBrief("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Plan generation failed");
    } finally {
      setLoading(false);
    }
  }

  const errorCount = result?.issues.filter((i) => i.severity === "error").length ?? 0;
  const warnCount = result?.issues.filter((i) => i.severity === "warning").length ?? 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <label
          htmlFor="brief"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          {result ? "Refine the plan" : `Describe the campaign for ${accountName}`}
        </label>
        <textarea
          id="brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={3}
          placeholder={
            result
              ? "Make the second ad set broader and drop its budget to 1,500."
              : "What are you trying to do, for whom, and at what budget?"
          }
          className="mt-3 w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-[15px] outline-none focus:border-accent"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => generate(Boolean(result))}
            disabled={!brief.trim() || loading}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Wand2 className="h-4 w-4" aria-hidden />
            )}
            {loading ? "Planning" : result ? "Apply change" : "Draft the plan"}
          </button>
          {result && (
            <button
              onClick={() => {
                setResult(null);
                setBrief("");
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
            >
              Start over
            </button>
          )}
        </div>

        {!result && (
          <div className="mt-4 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
              Try
            </p>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setBrief(ex)}
                className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] text-muted hover:bg-background hover:text-foreground"
              >
                {ex}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-danger bg-danger-subtle p-4 text-[15px] text-danger">
          {error}
        </div>
      )}

      {/* What the agent actually did. Shown whether or not it produced a
          plan, because "searched the library for missed calls, 6 matches" is
          how you tell a good pick from a lucky one. */}
      {result && result.steps.length > 0 && (
        <ol className="space-y-1.5 rounded-2xl border border-border bg-surface px-5 py-4">
          {result.steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13px] text-muted">
              <span
                className="mt-0.5 text-[11px] font-semibold text-accent"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              {s.summary}
            </li>
          ))}
        </ol>
      )}

      {result && !result.plan && result.message && (
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-[15px] leading-relaxed text-foreground">
            {result.message}
          </p>
          <p className="mt-2 text-[13px] text-subtle">
            Answer above and draft again.
          </p>
        </div>
      )}

      {result?.plan && (
        <div className="space-y-4">
          {/* Verdict bar. Spend first, because it is the number that decides
              whether anyone reads the rest. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                Commits per day
              </p>
              <p
                className="mt-0.5 text-2xl font-bold"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {money(result.dailySpendCents, result.currency)}
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {errorCount > 0 ? (
                <span className="rounded-full bg-danger-subtle px-3 py-1 font-semibold text-danger">
                  {errorCount} blocking {errorCount === 1 ? "issue" : "issues"}
                </span>
              ) : (
                <span className="rounded-full bg-success-subtle px-3 py-1 font-semibold text-success">
                  Passes validation
                </span>
              )}
              {warnCount > 0 && (
                <span className="rounded-full bg-warning-subtle px-3 py-1 font-semibold text-warning">
                  {warnCount} to check
                </span>
              )}
              
            </div>
          </div>

          {result.plan!.rationale && (
            <p className="text-[15px] leading-relaxed text-muted">
              {result.plan!.rationale}
            </p>
          )}

          {/* Campaign */}
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3
                className="text-lg font-semibold"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {result.plan!.campaign.name}
              </h3>
              <span className="text-xs font-medium uppercase tracking-wide text-subtle">
                {result.plan!.campaign.objective}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {result.plan!.campaign.budgetType
                ? `Campaign budget optimisation on, ${result.plan!.campaign.budgetType} ${money(result.plan!.campaign.budgetCents ?? 0, result.currency)}`
                : "Budget set per ad set"}
              {result.plan!.campaign.specialAdCategories.length > 0 &&
                ` · ${result.plan!.campaign.specialAdCategories.join(", ")}`}
            </p>
            <IssueList items={issuesFor(result.issues, "campaign")} />
            <IssueList items={issuesFor(result.issues, "metaAdAccountId")} />
          </div>

          {/* Ad sets */}
          {result.plan!.adSets.map((s, i) => {
            const open = openSets[i] ?? false;
            const setIssues = issuesFor(result.issues, `adSets[${i}]`);
            const setErrors = setIssues.filter((x) => x.severity === "error");
            return (
              <div
                key={i}
                className="overflow-hidden rounded-2xl border border-border bg-surface"
              >
                <button
                  onClick={() => setOpenSets((p) => ({ ...p, [i]: !open }))}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-background"
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{s.name}</p>
                    <p className="mt-0.5 text-[13px] text-muted">
                      {s.optimizationGoal}
                      {s.budgetCents
                        ? ` · ${s.budgetType} ${money(s.budgetCents, result.currency)}`
                        : " · campaign budget"}
                      {` · ${s.targeting.countries.join(", ")} ${s.targeting.ageMin} to ${s.targeting.ageMax}`}
                      {` · ${s.ads.length} ${s.ads.length === 1 ? "ad" : "ads"}`}
                    </p>
                  </div>
                  {setErrors.length > 0 && (
                    <span className="shrink-0 rounded-full bg-danger-subtle px-2.5 py-0.5 text-xs font-semibold text-danger">
                      {setErrors.length}
                    </span>
                  )}
                </button>

                {open && (
                  <div className="border-t border-border px-5 py-4">
                    <IssueList items={setIssues} />
                    <div className="mt-3 space-y-3">
                      {s.ads.map((ad, j) => (
                        <div
                          key={j}
                          className="rounded-xl border border-border bg-background p-4"
                        >
                          <p className="text-[13px] font-semibold text-subtle">
                            {ad.name}
                          </p>
                          <p className="mt-1.5 text-[15px] font-semibold">
                            {ad.headline}
                          </p>
                          <p className="mt-1 text-[15px] leading-relaxed text-muted">
                            {ad.primaryText}
                          </p>
                          <p className="mt-2 text-xs text-subtle">
                            {ad.mediaType}
                            {ad.linkUrl ? ` · ${ad.linkUrl}` : " · messaging destination"}
                            {ad.callToAction ? ` · ${ad.callToAction}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* The payload preview. Same discipline as the create forms: the
              reviewer can audit exactly what would hit Meta. */}
          <div className="rounded-2xl border border-border bg-surface">
            <button
              onClick={() => setShowPayload((v) => !v)}
              className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-medium text-muted hover:text-foreground"
            >
              {showPayload ? (
                <ChevronDown className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4" aria-hidden />
              )}
              Plan JSON
            </button>
            {showPayload && (
              <pre
                className="max-h-96 overflow-auto border-t border-border px-5 py-4 text-[12px] leading-relaxed"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {JSON.stringify(result.plan, null, 2)}
              </pre>
            )}
          </div>

          <p className="rounded-xl border border-border bg-background px-5 py-4 text-[13px] leading-relaxed text-muted">
            Nothing here has been created. This phase produces and validates a
            plan only. Execution against Meta is a separate, explicitly
            approved step that does not exist yet.
          </p>
        </div>
      )}
    </div>
  );
}
