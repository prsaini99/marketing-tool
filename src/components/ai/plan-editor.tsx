"use client";

/**
 * Editable campaign plan.
 *
 * Two modes over the same object: inline fields for the things people
 * actually change (names, budgets, ad copy, targeting), and raw JSON as the
 * escape hatch for everything else. Both write to one `plan` prop owned by
 * the parent, so switching modes never loses an edit.
 *
 * VALIDATION RUNS IN THE BROWSER, ON EVERY KEYSTROKE. validatePlan is pure,
 * so the same function the server used can re-check an edited plan with no
 * round trip. That is the payoff of keeping the validator free of I/O: a
 * budget typed past the spend ceiling goes red immediately rather than after
 * a request, and the rules a person is editing against are the same rules
 * that would reject the plan later.
 *
 * The options come from the server rather than being rebuilt here, so client
 * and server cannot drift into different ceilings or budget floors.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Code2, ImageIcon, ListTree } from "lucide-react";
import {
  type CampaignPlan,
  type PlanAd,
  type PlanAdSet,
  type PlanIssue,
} from "@/lib/campaign-plan";
import { cn } from "@/lib/utils";
import type { PickerAsset } from "./campaign-copilot";

/** Cheap structural clone so edits never mutate the object we were handed. */
function clone(plan: CampaignPlan): CampaignPlan {
  return JSON.parse(JSON.stringify(plan)) as CampaignPlan;
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">
        {label}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-subtle">{hint}</span>}
    </label>
  );
}

const inputCls =
  "mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[14px] outline-none focus:border-accent";

/** Money fields are edited in major units; the plan stores cents. */
function MoneyInput({
  cents,
  currency,
  onChange,
}: {
  cents: number | undefined;
  currency: string;
  onChange: (cents: number | undefined) => void;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        min={0}
        value={cents === undefined ? "" : cents / 100}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? undefined : Math.round(Number(v) * 100));
        }}
        className={cn(inputCls, "pr-12")}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-subtle">
        {currency}
      </span>
    </div>
  );
}

function IssueDots({ issues }: { issues: PlanIssue[] }) {
  const errors = issues.filter((i) => i.severity === "error").length;
  if (errors === 0) return null;
  return (
    <span className="shrink-0 rounded-full bg-danger-subtle px-2 py-0.5 text-[11px] font-semibold text-danger">
      {errors}
    </span>
  );
}

export function PlanEditor({
  plan,
  issues,
  currency,
  assets,
  onChange,
}: {
  plan: CampaignPlan;
  issues: PlanIssue[];
  currency: string;
  /** The account library, so each ad's creative can be changed in place. */
  assets: PickerAsset[];
  onChange: (next: CampaignPlan) => void;
}) {
  const [mode, setMode] = useState<"fields" | "json">("fields");
  const [openSets, setOpenSets] = useState<Record<number, boolean>>({ 0: true });
  // Raw JSON text is separate state so a half-typed edit is not thrown away
  // on every keystroke by a failed parse.
  const [draft, setDraft] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  function patch(fn: (draft: CampaignPlan) => void) {
    const next = clone(plan);
    fn(next);
    onChange(next);
  }

  function patchSet(i: number, fn: (s: PlanAdSet) => void) {
    patch((d) => fn(d.adSets[i]));
  }

  const issuesFor = (prefix: string) =>
    issues.filter((i) => i.path.startsWith(prefix));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
        {(
          [
            ["fields", "Edit fields", ListTree],
            ["json", "Edit JSON", Code2],
          ] as const
        ).map(([m, label, Icon]) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              if (m === "json") setDraft(JSON.stringify(plan, null, 2));
              setParseError(null);
              setMode(m);
            }}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              mode === m
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {mode === "json" ? (
        <div>
          <textarea
            value={draft ?? JSON.stringify(plan, null, 2)}
            onChange={(e) => {
              const text = e.target.value;
              setDraft(text);
              try {
                const parsed = JSON.parse(text) as CampaignPlan;
                setParseError(null);
                // Account id is not the editor's to change: a plan pointed at
                // another account is a cross-account write waiting to happen.
                onChange({ ...parsed, metaAdAccountId: plan.metaAdAccountId });
              } catch (e2) {
                setParseError(e2 instanceof Error ? e2.message : "Invalid JSON");
              }
            }}
            spellCheck={false}
            rows={22}
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-[12px] leading-relaxed outline-none focus:border-accent"
            style={{ fontFamily: "var(--font-mono)" }}
          />
          {parseError ? (
            <p className="mt-1.5 text-[13px] text-danger">
              Not valid JSON yet: {parseError}
            </p>
          ) : (
            <p className="mt-1.5 text-[13px] text-subtle">
              Edits apply as you type and are re-validated live. The ad account
              id is fixed.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Campaign */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-[13px] font-semibold uppercase tracking-wide text-subtle">
                Campaign
              </h4>
              <IssueDots issues={issuesFor("campaign")} />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <input
                  value={plan.campaign.name}
                  onChange={(e) => patch((d) => void (d.campaign.name = e.target.value))}
                  className={inputCls}
                />
              </Field>
              <Field label="Objective">
                <select
                  value={plan.campaign.objective}
                  onChange={(e) =>
                    patch(
                      (d) =>
                        void (d.campaign.objective = e.target
                          .value as CampaignPlan["campaign"]["objective"]),
                    )
                  }
                  className={inputCls}
                >
                  {[
                    "OUTCOME_AWARENESS",
                    "OUTCOME_TRAFFIC",
                    "OUTCOME_ENGAGEMENT",
                    "OUTCOME_LEADS",
                    "OUTCOME_APP_PROMOTION",
                    "OUTCOME_SALES",
                  ].map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Budget level"
                hint="Campaign budget means ad sets must not carry their own."
              >
                <select
                  value={plan.campaign.budgetType ?? "adset"}
                  onChange={(e) =>
                    patch((d) => {
                      d.campaign.budgetType =
                        e.target.value === "adset"
                          ? null
                          : (e.target.value as "daily" | "lifetime");
                      if (d.campaign.budgetType === null) d.campaign.budgetCents = undefined;
                    })
                  }
                  className={inputCls}
                >
                  <option value="adset">Per ad set</option>
                  <option value="daily">Campaign, daily</option>
                  <option value="lifetime">Campaign, lifetime</option>
                </select>
              </Field>
              {plan.campaign.budgetType && (
                <Field label="Campaign budget">
                  <MoneyInput
                    cents={plan.campaign.budgetCents}
                    currency={currency}
                    onChange={(c) => patch((d) => void (d.campaign.budgetCents = c))}
                  />
                </Field>
              )}
            </div>
          </div>

          {/* Ad sets */}
          {plan.adSets.map((s, i) => {
            const open = openSets[i] ?? false;
            return (
              <div key={i} className="overflow-hidden rounded-xl border border-border bg-surface">
                <button
                  type="button"
                  onClick={() => setOpenSets((p) => ({ ...p, [i]: !open }))}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-background"
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                    {s.name || `Ad set ${i + 1}`}
                  </span>
                  <IssueDots issues={issuesFor(`adSets[${i}]`)} />
                </button>

                {open && (
                  <div className="space-y-3 border-t border-border px-4 py-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Name">
                        <input
                          value={s.name}
                          onChange={(e) => patchSet(i, (x) => void (x.name = e.target.value))}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Optimization goal">
                        <input
                          value={s.optimizationGoal}
                          onChange={(e) =>
                            patchSet(i, (x) => void (x.optimizationGoal = e.target.value))
                          }
                          className={inputCls}
                        />
                      </Field>
                      {plan.campaign.budgetType === null && (
                        <Field label="Ad set budget">
                          <MoneyInput
                            cents={s.budgetCents}
                            currency={currency}
                            onChange={(c) => patchSet(i, (x) => void (x.budgetCents = c))}
                          />
                        </Field>
                      )}
                      <Field label="Countries" hint="Comma separated ISO codes.">
                        <input
                          value={s.targeting.countries.join(", ")}
                          onChange={(e) =>
                            patchSet(
                              i,
                              (x) =>
                                void (x.targeting.countries = e.target.value
                                  .split(",")
                                  .map((c) => c.trim().toUpperCase())
                                  .filter(Boolean)),
                            )
                          }
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Age range">
                        <div className="mt-1 flex items-center gap-2">
                          <input
                            type="number"
                            value={s.targeting.ageMin}
                            onChange={(e) =>
                              patchSet(i, (x) => void (x.targeting.ageMin = Number(e.target.value)))
                            }
                            className={cn(inputCls, "mt-0")}
                          />
                          <span className="text-subtle">to</span>
                          <input
                            type="number"
                            value={s.targeting.ageMax}
                            onChange={(e) =>
                              patchSet(i, (x) => void (x.targeting.ageMax = Number(e.target.value)))
                            }
                            className={cn(inputCls, "mt-0")}
                          />
                        </div>
                      </Field>
                    </div>

                    {s.ads.map((ad, j) => (
                      <div key={j} className="rounded-lg border border-border bg-background p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">
                          Ad {j + 1}
                        </p>
                        <div className="mt-2 space-y-2">
                          <AdCreativePicker
                            ad={ad}
                            assets={assets}
                            onPick={(a) =>
                              patchSet(i, (x) => {
                                const target = x.ads[j];
                                target.mediaType = a.kind;
                                if (a.kind === "image") {
                                  target.imageHash = a.id;
                                  // Clear the other side. An ad carrying both
                                  // an image hash and a video id is ambiguous,
                                  // and Meta picks one without telling you.
                                  target.videoId = undefined;
                                } else {
                                  target.videoId = a.id;
                                  target.imageHash = undefined;
                                }
                              })
                            }
                          />
                          <Field label="Headline">
                            <input
                              value={ad.headline}
                              onChange={(e) =>
                                patchSet(i, (x) => void (x.ads[j].headline = e.target.value))
                              }
                              className={inputCls}
                            />
                          </Field>
                          <Field label="Primary text">
                            <textarea
                              value={ad.primaryText}
                              rows={3}
                              onChange={(e) =>
                                patchSet(i, (x) => void (x.ads[j].primaryText = e.target.value))
                              }
                              className={cn(inputCls, "resize-y")}
                            />
                          </Field>
                          <Field label="Destination URL" hint="Not needed for a messaging goal.">
                            <input
                              value={ad.linkUrl ?? ""}
                              onChange={(e) =>
                                patchSet(
                                  i,
                                  (x) => void (x.ads[j].linkUrl = e.target.value || undefined),
                                )
                              }
                              className={inputCls}
                            />
                          </Field>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Choose the creative for ONE ad.
 *
 * Separate from the plan-level pin picker, and they answer different
 * questions. Pinning constrains what the agent may produce, before it plans.
 * This changes what a specific ad uses, after. Conflating them would mean
 * either pinning could not be enforced or an edit could not be made without
 * regenerating.
 */
function AdCreativePicker({
  ad,
  assets,
  onPick,
}: {
  ad: PlanAd;
  assets: PickerAsset[];
  onPick: (asset: PickerAsset) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentId = ad.mediaType === "video" ? ad.videoId : ad.imageHash;
  const current = assets.find((a) => a.id === currentId) ?? null;

  return (
    <div>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">
        Creative
      </span>
      <div className="mt-1 flex items-center gap-2.5 rounded-md border border-border bg-background p-2">
        <span className="h-11 w-11 shrink-0 overflow-hidden rounded bg-surface-2">
          {current?.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-subtle">
              <ImageIcon className="h-4 w-4" aria-hidden />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">
            {current?.name ?? (currentId ? "Not in this library" : "No creative set")}
          </span>
          <span className="block truncate text-[11px] text-subtle">
            {currentId
              ? `${ad.mediaType} · ${currentId}`
              : "The plan will fail validation without one."}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-muted hover:text-foreground"
        >
          {open ? "Close" : "Change"}
        </button>
      </div>

      {open && (
        <div className="mt-2 grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto rounded-md border border-border bg-background p-2 sm:grid-cols-6">
          {assets.length === 0 && (
            <p className="col-span-full text-[12px] text-subtle">
              Nothing in this account&apos;s library.
            </p>
          )}
          {assets.map((a) => (
            <button
              key={`${a.kind}:${a.id}`}
              type="button"
              title={a.insight ?? `${a.name} (not analysed)`}
              onClick={() => {
                onPick(a);
                setOpen(false);
              }}
              className={cn(
                "relative aspect-square overflow-hidden rounded border bg-surface-2",
                a.id === currentId
                  ? "border-accent ring-2 ring-accent"
                  : "border-border hover:border-border-strong",
              )}
            >
              {a.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.thumb} alt={a.name} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-subtle">
                  <ImageIcon className="h-4 w-4" aria-hidden />
                </span>
              )}
              {a.kind === "video" && (
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[8px] text-white">
                  Video
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
