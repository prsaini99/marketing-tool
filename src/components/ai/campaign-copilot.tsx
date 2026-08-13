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
  Check,
  ChevronDown,
  ChevronRight,
  ImageIcon,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  planDailySpendCents,
  validatePlan,
  type CampaignPlan,
  type PlanIssue,
  type ValidateOptions,
} from "@/lib/campaign-plan";
import { PlanEditor } from "./plan-editor";

/** One library asset the operator can pin. Resolved server-side. */
export interface PickerAsset {
  kind: "image" | "video";
  /** imageHash for an image, metaVideoId for a video. */
  id: string;
  name: string;
  thumb: string | null;
  /** Vision description or transcript excerpt. Null means unanalysed. */
  insight: string | null;
}

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
  validateOptions: ValidateOptions;
}

const EXAMPLES = [
  "Launch a traffic campaign for our AI automation service, 2,000 a day, India, 25 to 45, split into a broad ad set and one retargeting our website visitors.",
  "Set up a click-to-message campaign so people can DM us from the ad, 1,500 a day, engagement objective.",
  "Three ad sets testing different age bands for the saree collection, 1,000 a day each, sales objective on our purchase conversion.",
];

function money(cents: number, currency: string): string {
  return `${(cents / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })} ${currency}`;
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
  assets,
}: {
  adAccountId: string;
  accountName: string;
  assets: PickerAsset[];
}) {
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlanResponse | null>(null);
  // The plan the user is editing. Seeded from the agent's answer and then
  // owned here, so edits survive re-renders and mode switches.
  const [edited, setEdited] = useState<CampaignPlan | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Keyed "image:hash" / "video:id" so the two id spaces cannot collide.
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  const pinnedAssets = assets.filter((a) => pinned.has(`${a.kind}:${a.id}`));

  function togglePin(a: PickerAsset) {
    const key = `${a.kind}:${a.id}`;
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
          pinnedImageHashes: pinnedAssets
            .filter((a) => a.kind === "image")
            .map((a) => a.id),
          pinnedVideoIds: pinnedAssets
            .filter((a) => a.kind === "video")
            .map((a) => a.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Plan generation failed");
      const parsed = data as PlanResponse;
      setResult(parsed);
      setEdited(parsed.plan);
      setBrief("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Plan generation failed");
    } finally {
      setLoading(false);
    }
  }

  // Live validation. validatePlan is pure, so the browser runs the same
  // function the server did, with the same options, on every keystroke. No
  // round trip, and no chance of the two disagreeing about the rules.
  const liveIssues =
    edited && result ? validatePlan(edited, result.validateOptions) : (result?.issues ?? []);
  const liveSpend = edited ? planDailySpendCents(edited) : (result?.dailySpendCents ?? 0);
  const dirty =
    Boolean(edited && result?.plan) &&
    JSON.stringify(edited) !== JSON.stringify(result?.plan);

  const errorCount = liveIssues.filter((i) => i.severity === "error").length;
  const warnCount = liveIssues.filter((i) => i.severity === "warning").length;

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

        {/* Pin creatives. A pinned asset is a HARD constraint: a plan that
            fails to use one is rejected by the validator, because pinning is
            an act of having already decided. How they spread across ad sets
            is left to the brief. */}
        <div className="mt-4 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-muted hover:text-foreground"
            >
              <ImageIcon className="h-3.5 w-3.5" aria-hidden />
              {pinnedAssets.length > 0
                ? `${pinnedAssets.length} creative${pinnedAssets.length === 1 ? "" : "s"} pinned`
                : "Pin creatives"}
              {pickerOpen ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
            {pinnedAssets.length > 0 && (
              <button
                type="button"
                onClick={() => setPinned(new Set())}
                className="text-[13px] text-subtle hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>

          {pinnedAssets.length > 0 && (
            <p className="mt-2 text-[13px] text-muted">
              The plan will use only {pinnedAssets.length === 1 ? "this" : "these"}
              . Nothing else from the library, and a draft that leaves{" "}
              {pinnedAssets.length === 1 ? "it" : "one"} out is rejected. Pin
              nothing to let the copilot choose.
            </p>
          )}

          {pickerOpen && (
            <div className="mt-3">
              {assets.length === 0 ? (
                <p className="text-[13px] text-subtle">
                  Nothing in this account&apos;s library yet. Upload from the
                  Creative library, or let a sync bring assets in.
                </p>
              ) : (
                <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
                  {assets.map((a) => {
                    const key = `${a.kind}:${a.id}`;
                    const on = pinned.has(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => togglePin(a)}
                        title={a.insight ?? `${a.name} (not analysed yet)`}
                        className={cn(
                          "group relative aspect-square overflow-hidden rounded-lg border bg-surface-2 transition-all",
                          on
                            ? "border-accent ring-2 ring-accent"
                            : "border-border hover:border-border-strong",
                        )}
                      >
                        {a.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={a.thumb}
                            alt={a.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-subtle">
                            <ImageIcon className="h-5 w-5" aria-hidden />
                          </span>
                        )}
                        {on && (
                          <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-foreground">
                            <Check className="h-2.5 w-2.5" aria-hidden />
                          </span>
                        )}
                        {a.kind === "video" && (
                          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] font-medium text-white">
                            Video
                          </span>
                        )}
                        {/* An unanalysed asset is one the agent can only
                            identify by filename, which is worth knowing
                            before pinning it. */}
                        {!a.insight && (
                          <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[9px] text-white">
                            ?
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
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
                {money(liveSpend, result.currency)}
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
              {dirty && (
                <button
                  type="button"
                  onClick={() => setEdited(result.plan)}
                  className="rounded-full border border-border px-3 py-1 text-[13px] font-medium text-muted hover:text-foreground"
                >
                  Revert edits
                </button>
              )}
            </div>
          </div>

          {result.plan!.rationale && (
            <p className="text-[15px] leading-relaxed text-muted">
              {result.plan!.rationale}
            </p>
          )}

          {edited && (
            <PlanEditor
              plan={edited}
              issues={liveIssues}
              currency={result.currency}
              assets={assets}
              onChange={setEdited}
            />
          )}

          {liveIssues.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface p-5">
              <h4 className="text-[13px] font-semibold uppercase tracking-wide text-subtle">
                Validation
              </h4>
              <IssueList items={liveIssues} />
            </div>
          )}

          <p className="rounded-xl border border-border bg-background px-5 py-4 text-[13px] leading-relaxed text-muted">
            Nothing here has been created. Edits are re-validated as you type,
            using the same rules the server applied. Execution against Meta is
            a separate, explicitly approved step that does not exist yet.
          </p>
        </div>
      )}
    </div>
  );
}
