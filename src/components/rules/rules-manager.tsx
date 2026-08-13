"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Play, Plus, Trash2, Zap } from "lucide-react";
import { describeRule, type RuleScope } from "@/lib/ad-rules";
import { ConfirmModal } from "@/components/ui/confirm-modal";

/**
 * Automated rules — create, preview, enable, delete.
 *
 * THE ENABLE FLOW IS THE POINT. A rule is the only thing in this product a
 * user confirms ONCE that then acts on their ads repeatedly without them, so
 * the interaction is deliberately three steps: create (saved disabled) →
 * preview against live data → enable behind a confirm modal that spells out
 * the whole behaviour in a sentence, guards included.
 *
 * Creating a rule can never pause anything: the API forces `enabled: false`
 * on create regardless of what the client sends, so the preview always
 * happens before any action is possible.
 */

interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  scope: string;
  metric: string;
  operator: string;
  threshold: number;
  windowDays: number;
  minSpendCents: number;
  action: string;
  cooldownHours: number;
  lastFiredAt: string | null;
  entityIds: string[];
}

interface Evaluation {
  entityId: string;
  entityName: string;
  fires: boolean;
  skipReason?: string;
  explanation: string;
}

interface PreviewResult {
  ruleName: string;
  entitiesEvaluated: number;
  fired: number;
  evaluations: Evaluation[];
}

const METRICS = [
  { key: "cpa", label: "CPA" },
  { key: "spend", label: "Spend" },
  { key: "roas", label: "ROAS" },
  { key: "ctr", label: "CTR" },
];

const SCOPES = [
  { key: "campaign", label: "Campaign" },
  { key: "adset", label: "Ad set" },
  { key: "ad", label: "Ad" },
];

export function RulesManager({
  adAccountId,
  currencySymbol = "₹",
}: {
  adAccountId: string;
  currencySymbol?: string;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, PreviewResult>>({});
  const [pendingEnable, setPendingEnable] = useState<Rule | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Rule | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [scope, setScope] = useState("campaign");
  const [metric, setMetric] = useState("cpa");
  const [operator, setOperator] = useState("gt");
  const [threshold, setThreshold] = useState("500");
  const [windowDays, setWindowDays] = useState("3");
  const [minSpend, setMinSpend] = useState("1000");
  const [action, setAction] = useState("pause");
  const [cooldownHours, setCooldownHours] = useState("24");
  // Entity targeting: "all" watches every entity of the chosen scope;
  // "specific" restricts to the checked ids. The list loads lazily when the
  // user opts into specific targeting, and reloads when scope changes —
  // campaign ids are meaningless to an ad-scoped rule.
  const [targeting, setTargeting] = useState<"all" | "specific">("all");
  const [entities, setEntities] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rules?adAccountId=${encodeURIComponent(adAccountId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load rules");
      setRules(json.rules ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rules");
    } finally {
      setLoading(false);
    }
  }, [adAccountId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Scope changed: previously selected ids belong to a different entity
    // type and must not silently ride along onto the new scope.
    setSelectedEntityIds(new Set());
    setEntities([]);
    if (targeting !== "specific") return;
    let cancelled = false;
    (async () => {
      setEntitiesLoading(true);
      try {
        const res = await fetch(
          `/api/rules/entities?adAccountId=${encodeURIComponent(adAccountId)}&scope=${scope}`,
        );
        const json = await res.json();
        if (!cancelled && res.ok) setEntities(json.entities ?? []);
      } finally {
        if (!cancelled) setEntitiesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targeting, scope, adAccountId]);

  async function create() {
    if (targeting === "specific" && selectedEntityIds.size === 0) {
      // "Specific" with nothing ticked would silently become "all" server-side
      // (empty list = everything) — the opposite of what the user asked for.
      setError("Pick at least one entity, or switch back to All.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          adAccountId,
          name: name.trim() || `${metric.toUpperCase()} rule`,
          scope,
          metric,
          operator,
          threshold: Number(threshold),
          windowDays: Number(windowDays),
          minSpend: Number(minSpend),
          action,
          cooldownHours: Number(cooldownHours),
          entityIds: targeting === "specific" ? [...selectedEntityIds] : [],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create rule");
      setShowForm(false);
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create rule");
    } finally {
      setCreating(false);
    }
  }

  async function runPreview(rule: Rule) {
    setPreviewing(rule.id);
    setError(null);
    try {
      const res = await fetch(`/api/rules/${rule.id}/preview`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Preview failed");
      setPreview((p) => ({ ...p, [rule.id]: json as PreviewResult }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewing(null);
    }
  }

  async function setEnabled(rule: Rule, enabled: boolean) {
    setError(null);
    try {
      const res = await fetch(`/api/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to update rule");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update rule");
    }
  }

  async function remove(rule: Rule) {
    setError(null);
    try {
      const res = await fetch(`/api/rules/${rule.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete rule");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete rule");
    }
  }

  const describePending = pendingEnable
    ? describeRule(
        {
          metric: pendingEnable.metric as never,
          operator: pendingEnable.operator as never,
          threshold: pendingEnable.threshold,
          windowDays: pendingEnable.windowDays,
          action: pendingEnable.action as never,
          minSpendCents: pendingEnable.minSpendCents,
          cooldownHours: pendingEnable.cooldownHours,
        },
        pendingEnable.scope as RuleScope,
        currencySymbol,
      )
    : "";

  return (
    <section className="rounded-lg border border-border">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-muted" />
          <div>
            <h2 className="text-sm font-semibold">Automated rules</h2>
            <p className="text-xs text-muted">
              Pause or flag entities when performance crosses a threshold.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2"
        >
          <Plus className="h-3.5 w-3.5" />
          New rule
        </button>
      </header>

      {showForm && (
        <div className="space-y-3 border-b border-border bg-surface px-4 py-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rule name"
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <select value={scope} onChange={(e) => setScope(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              {SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select value={metric} onChange={(e) => setMetric(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <select value={operator} onChange={(e) => setOperator(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              <option value="gt">is above</option>
              <option value="lt">is below</option>
            </select>
            <input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              inputMode="decimal"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              placeholder="Threshold"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs text-muted">
              Window (days)
              <input value={windowDays} onChange={(e) => setWindowDays(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-muted">
              Min spend ({currencySymbol})
              <input value={minSpend} onChange={(e) => setMinSpend(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-muted">
              Cooldown (h)
              <input value={cooldownHours} onChange={(e) => setCooldownHours(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-muted">
              Action
              <select value={action} onChange={(e) => setAction(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm">
                <option value="pause">Pause</option>
                <option value="notify">Notify only</option>
              </select>
            </label>
          </div>
          <div>
            <div className="flex gap-1 text-xs">
              <button
                type="button"
                onClick={() => setTargeting("all")}
                className={`rounded-md px-2 py-1 font-medium ${targeting === "all" ? "bg-accent text-accent-foreground" : "border border-border text-muted hover:text-foreground"}`}
              >
                All {scope === "campaign" ? "campaigns" : scope === "adset" ? "ad sets" : "ads"}
              </button>
              <button
                type="button"
                onClick={() => setTargeting("specific")}
                className={`rounded-md px-2 py-1 font-medium ${targeting === "specific" ? "bg-accent text-accent-foreground" : "border border-border text-muted hover:text-foreground"}`}
              >
                Specific…
              </button>
            </div>
            {targeting === "specific" && (
              <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-border bg-background px-2 py-1.5">
                {entitiesLoading && (
                  <p className="py-2 text-xs text-muted">Loading…</p>
                )}
                {!entitiesLoading && entities.length === 0 && (
                  <p className="py-2 text-xs text-muted">
                    Nothing synced at this level yet.
                  </p>
                )}
                {entities.map((e) => (
                  <label
                    key={e.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-surface-2"
                  >
                    <input
                      type="checkbox"
                      checked={selectedEntityIds.has(e.id)}
                      onChange={(ev) => {
                        const next = new Set(selectedEntityIds);
                        if (ev.target.checked) next.add(e.id);
                        else next.delete(e.id);
                        setSelectedEntityIds(next);
                      }}
                    />
                    <span className="flex-1 truncate">{e.name}</span>
                    <span className={e.status === "ACTIVE" ? "text-success" : "text-muted"}>
                      {e.status.toLowerCase()}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {targeting === "specific" && selectedEntityIds.size > 0 && (
              <p className="mt-1 text-xs text-muted">
                {selectedEntityIds.size} selected. The rule only evaluates these.
              </p>
            )}
          </div>

          <p className="text-xs text-muted">
            {describeRule(
              {
                metric: metric as never,
                operator: operator as never,
                threshold:
                  metric === "cpa" || metric === "spend"
                    ? Number(threshold) * 100
                    : Number(threshold),
                windowDays: Number(windowDays) || 1,
                action: action as never,
                minSpendCents: Number(minSpend) * 100,
                cooldownHours: Number(cooldownHours) || 1,
              },
              scope as RuleScope,
              currencySymbol,
            )}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium">
              Cancel
            </button>
            <button type="button" onClick={create} disabled={creating} className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-40">
              {creating ? "Creating…" : "Create (disabled)"}
            </button>
          </div>
        </div>
      )}

      <div className="px-4 py-3">
        {error && <p className="mb-2 text-xs text-danger">{error}</p>}
        {loading && <p className="py-4 text-center text-sm text-muted">Loading…</p>}

        {!loading && rules.length === 0 && (
          <p className="py-6 text-center text-sm text-muted">
            No rules yet. A rule watches one metric and pauses or flags when it
            crosses your threshold.
          </p>
        )}

        <ul className="space-y-3">
          {rules.map((r) => {
            const p = preview[r.id];
            return (
              <li key={r.id} className="rounded-md border border-border px-3 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{r.name}</span>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${r.enabled ? "bg-success/10 text-success" : "bg-surface-2 text-muted"}`}>
                        {r.enabled ? "Active" : "Disabled"}
                      </span>
                      {r.action === "pause" && (
                        <span className="rounded bg-warning/10 px-1.5 py-0.5 text-xs text-warning">
                          pauses ads
                        </span>
                      )}
                      {r.entityIds.length > 0 && (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">
                          {r.entityIds.length} specific
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {describeRule(
                        {
                          metric: r.metric as never,
                          operator: r.operator as never,
                          threshold: r.threshold,
                          windowDays: r.windowDays,
                          action: r.action as never,
                          minSpendCents: r.minSpendCents,
                          cooldownHours: r.cooldownHours,
                        },
                        r.scope as RuleScope,
                        currencySymbol,
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" onClick={() => runPreview(r)} disabled={previewing === r.id} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-2 disabled:opacity-40">
                      {previewing === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => (r.enabled ? setEnabled(r, false) : setPendingEnable(r))}
                      className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-2"
                    >
                      {r.enabled ? "Disable" : "Enable"}
                    </button>
                    <button type="button" onClick={() => setPendingDelete(r)} className="rounded-md border border-border p-1 text-muted hover:text-danger" aria-label="Delete rule">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {p && (
                  <div className="mt-2.5 rounded border border-border bg-surface px-2.5 py-2">
                    <p className="text-xs font-medium">
                      {p.fired === 0
                        ? `Would act on nothing (${p.entitiesEvaluated} evaluated).`
                        : `Would ${r.action === "pause" ? "pause" : "flag"} ${p.fired} of ${p.entitiesEvaluated}.`}
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {p.evaluations.slice(0, 8).map((e) => (
                        <li key={e.entityId} className="flex gap-1.5 text-xs">
                          {e.fires ? (
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                          ) : (
                            <span className="mt-0.5 h-3 w-3 shrink-0" />
                          )}
                          <span className={e.fires ? "text-foreground" : "text-muted"}>
                            <span className="font-medium">{e.entityName}</span>: {e.explanation}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <ConfirmModal
        open={pendingEnable !== null}
        title="Enable this rule?"
        body={
          <div className="space-y-2">
            <p>{describePending}</p>
            <p className="font-medium text-foreground">
              Once enabled this runs automatically every day, without asking
              again.
            </p>
          </div>
        }
        confirmLabel="Enable rule"
        onConfirm={async () => {
          if (pendingEnable) await setEnabled(pendingEnable, true);
          setPendingEnable(null);
        }}
        onCancel={() => setPendingEnable(null)}
      />

      <ConfirmModal
        open={pendingDelete !== null}
        title="Delete this rule?"
        body={`"${pendingDelete?.name}" will be removed. Anything it already paused stays paused.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (pendingDelete) await remove(pendingDelete);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
