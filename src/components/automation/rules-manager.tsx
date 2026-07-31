"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Activity, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { ConfirmModal } from "@/components/ui/confirm-modal";

export interface RuleRow {
  id: string;
  enabled: boolean;
  priority: number;
  triggerType: string;
  keywords: string[];
  negativeKeywords: string[];
  skipNoIntent: boolean;
  aiIntentGuard: boolean;
  mediaScope: string;
  mediaId: string | null;
  publicReplyEnabled: boolean;
  publicReplyTemplate: string;
  dmEnabled: boolean;
  dmTemplate: string;
  aiFallback: boolean;
  aiInstructions: string;
  oncePerUser: boolean;
}

const EMPTY_RULE: Omit<RuleRow, "id"> = {
  enabled: true,
  priority: 100,
  triggerType: "COMMENT_KEYWORD",
  keywords: [],
  negativeKeywords: [],
  skipNoIntent: false,
  aiIntentGuard: false,
  mediaScope: "ALL",
  mediaId: null,
  publicReplyEnabled: false,
  publicReplyTemplate: "",
  dmEnabled: true,
  dmTemplate: "",
  aiFallback: false,
  aiInstructions: "",
  oncePerUser: true,
};

interface MediaOption {
  id: string;
  caption: string | null;
  mediaType: string;
  isAd?: boolean;
  adStatus?: string | null;
  adName?: string | null;
}

interface DryRunOutcome {
  action: string;
  text: string | null;
  skipReason: string | null;
  status: string;
  metaError?: string;
}

export function RulesManager({
  accountId,
  initialRules,
  platform,
}: {
  accountId: string;
  initialRules: RuleRow[];
  platform?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<RuleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function toggleEnabled(rule: RuleRow) {
    setListError(null);
    const res = await fetch(`/api/automation/rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    if (!res.ok) {
      // Never let a failed toggle look like a success — the dangerous
      // direction is a failed DISABLE: the operator believes a live
      // auto-sending rule is off when Meta never got the update.
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setListError(
        `Couldn't ${rule.enabled ? "disable" : "enable"} this rule: ${data.error ?? "request failed"}`,
      );
      return;
    }
    router.refresh();
  }

  async function doDelete() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError(null);
    const res = await fetch(`/api/automation/rules/${deleting.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setDeleteError(data.error ?? "Delete failed");
      return;
    }
    setDeleting(null);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => setCreating(true)}
        className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground"
      >
        <Plus className="h-4 w-4" /> New rule
      </button>

      {listError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
          {listError}
        </p>
      )}

      {initialRules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No rules yet. A keyword rule like &quot;PRICE &rarr; DM the pricing
          link&quot; is the classic starter.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3">Prio</th>
              <th className="py-2 pr-3">Trigger</th>
              <th className="py-2 pr-3">Keywords</th>
              <th className="py-2 pr-3">Media</th>
              <th className="py-2 pr-3">Actions</th>
              <th className="py-2 pr-3">Enabled</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {initialRules.map((r) => (
              <tr key={r.id} className="border-b border-border">
                <td className="py-2 pr-3">{r.priority}</td>
                <td className="py-2 pr-3">{r.triggerType}</td>
                <td className="py-2 pr-3">
                  {r.keywords.map((k) => (
                    <span
                      key={k}
                      className="mr-1 rounded bg-surface px-1.5 py-0.5 text-xs border border-border"
                    >
                      {k}
                    </span>
                  ))}
                </td>
                <td className="py-2 pr-3 text-xs">{r.mediaId ?? "all"}</td>
                <td className="py-2 pr-3 text-xs">
                  {[
                    r.publicReplyEnabled ? "reply" : null,
                    r.dmEnabled ? "DM" : null,
                    r.aiFallback ? "+AI" : null,
                    r.negativeKeywords.length > 0 ? "−words" : null,
                    r.skipNoIntent ? "−noise" : null,
                    r.aiIntentGuard ? "−AI guard" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={() => toggleEnabled(r)}
                  />
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/dashboard/automation/${accountId}/rules/${r.id}/activity`}
                      title="Activity for this rule"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Activity className="h-4 w-4" />
                    </Link>
                    <button onClick={() => setEditing(r)} title="Edit rule">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => setDeleting(r)} title="Delete rule">
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(editing || creating) && (
        <RuleEditorModal
          accountId={accountId}
          initial={editing ?? ({ id: "", ...EMPTY_RULE } as RuleRow)}
          isNew={creating}
          platform={platform}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}

      <ConfirmModal
        open={deleting !== null}
        title="Delete this rule?"
        body="The bot will stop matching it immediately. Past activity log entries are kept."
        confirmLabel="Delete"
        variant="danger"
        loading={busy}
        error={deleteError}
        onCancel={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
        onConfirm={doDelete}
      />
    </div>
  );
}

function RuleEditorModal({
  accountId,
  initial,
  isNew,
  platform,
  onClose,
}: {
  accountId: string;
  initial: RuleRow;
  isNew: boolean;
  platform?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  // A DM rule can never carry a live publicReplyEnabled=true into this form
  // — there's no comment to reply to on a DM trigger, so a stale true from
  // before this trigger was switched to DM (or from before this guard
  // existed) must be sanitized on load, not just hidden in the UI.
  const [r, setR] = useState<RuleRow>(() =>
    initial.triggerType.startsWith("DM")
      ? { ...initial, publicReplyEnabled: false }
      : initial,
  );
  const [keywordInput, setKeywordInput] = useState("");
  const [negKeywordInput, setNegKeywordInput] = useState("");
  const [media, setMedia] = useState<MediaOption[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testText, setTestText] = useState("");
  const [testType, setTestType] = useState<"COMMENT" | "MESSAGE">(
    initial.triggerType.startsWith("DM") ? "MESSAGE" : "COMMENT",
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<DryRunOutcome[] | null>(null);
  const [testBotOff, setTestBotOff] = useState(false);

  useEffect(() => {
    fetch(`/api/automation/accounts/${accountId}/media`)
      .then((res) => (res.ok ? res.json() : { media: [] }))
      .then((data: { media?: MediaOption[]; error?: string }) => {
        setMedia(data.media ?? []);
        setMediaError(data.error ?? null);
      })
      .catch(() => {
        setMedia([]);
        setMediaError("Couldn't load posts from Meta.");
      });
  }, [accountId]);

  function addKeyword() {
    const k = keywordInput.trim();
    if (k && !r.keywords.includes(k)) setR({ ...r, keywords: [...r.keywords, k] });
    setKeywordInput("");
  }

  function addNegKeyword() {
    const k = negKeywordInput.trim();
    if (k && !r.negativeKeywords.includes(k)) {
      setR({ ...r, negativeKeywords: [...r.negativeKeywords, k] });
    }
    setNegKeywordInput("");
  }

  // Live Meta payload preview (repo convention for create forms).
  const preview =
    testType === "COMMENT"
      ? {
          ...(r.publicReplyEnabled
            ? {
                publicReply: {
                  POST: `/{comment-id}/replies`,
                  params: { message: r.publicReplyTemplate },
                },
              }
            : {}),
          ...(r.dmEnabled
            ? {
                dm: {
                  POST: "/{ig-user-id}/messages",
                  body: {
                    recipient: { comment_id: "<comment-id>" },
                    message: { text: r.dmTemplate },
                  },
                  note: "ONE message only, within 7 days of the comment",
                },
              }
            : {}),
        }
      : {
          dm: {
            POST: "/{ig-user-id}/messages",
            body: { recipient: { id: "<igsid>" }, message: { text: r.dmTemplate } },
            note: "within 24h of the user's last message",
          },
        };

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(
      isNew
        ? `/api/automation/accounts/${accountId}/rules`
        : `/api/automation/rules/${r.id}`,
      {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r),
      },
    );
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Save failed");
      return;
    }
    router.refresh();
    onClose();
  }

  async function dryRun() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/automation/dry-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        igAccountId: accountId,
        eventType: testType,
        text: testText,
        mediaId: r.mediaId,
        ruleOverride: r,
        // Exercise whichever AI path this rule actually uses, or the test
        // panel silently skips the classifier/AI-fallback call the dry-run
        // route defaults to false — making "Use AI to skip complaints" look
        // broken when the operator turns it on.
        callAi: r.aiFallback || r.aiIntentGuard,
      }),
    });
    const data = (await res.json()) as {
      outcomes?: DryRunOutcome[];
      error?: string;
      botEnabled?: boolean;
    };
    setTestResult(
      data.outcomes ?? [
        { action: "ERROR", text: null, skipReason: data.error ?? "failed", status: "FAILED" },
      ],
    );
    // A dry run evaluates rules even when the bot is off; say so, otherwise
    // a good preview implies live traffic is already being answered.
    setTestBotOff(data.botEnabled === false);
    setTesting(false);
  }

  const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
  const label = "block text-sm font-medium mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-background p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isNew ? "New rule" : "Edit rule"}</h2>
          <div className="flex items-center gap-3">
            {!isNew && (
              <Link
                href={`/dashboard/automation/${accountId}/rules/${r.id}/activity`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Activity className="h-3.5 w-3.5" />
                Activity
              </Link>
            )}
            <button onClick={onClose}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={label}>Trigger</label>
            <select
              className={input}
              value={r.triggerType}
              onChange={(e) => {
                const nextTriggerType = e.target.value;
                const isDm = nextTriggerType.startsWith("DM");
                setR({
                  ...r,
                  triggerType: nextTriggerType,
                  // A DM trigger has no comment to reply to — a stale
                  // publicReplyEnabled=true from a prior COMMENT trigger
                  // must not survive the switch (see C1 fix: this used to
                  // fire POST /null/replies on every inbound DM).
                  publicReplyEnabled: isDm ? false : r.publicReplyEnabled,
                  // An _ANY rule answers everything, so the noise filter is
                  // the sensible default there; a KEYWORD rule already
                  // implies intent.
                  skipNoIntent: nextTriggerType.endsWith("_ANY"),
                });
                setTestType(isDm ? "MESSAGE" : "COMMENT");
              }}
            >
              <option value="COMMENT_KEYWORD">Comment contains keyword</option>
              <option value="COMMENT_ANY">Any comment</option>
              <option value="DM_KEYWORD">DM contains keyword</option>
              <option value="DM_ANY">Any DM</option>
            </select>
          </div>
          <div>
            <label className={label}>Priority (lower runs first)</label>
            <input
              className={input}
              type="number"
              value={r.priority}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                setR({ ...r, priority: Number.isNaN(parsed) ? 100 : parsed });
              }}
            />
          </div>
        </div>

        {r.triggerType.endsWith("KEYWORD") && (
          <div className="mt-4">
            <label className={label}>
              Keywords (Enter to add) &mdash; whole word, case-insensitive
            </label>
            <p className="mb-1 text-xs text-muted-foreground">
              Matches only when the commenter says the whole word, so
              &quot;AI&quot; will not fire on &quot;said&quot; or
              &quot;again&quot;. Punctuation and emoji next to the word are
              fine; plurals are not (&quot;price&quot; won&apos;t match
              &quot;prices&quot; &mdash; add both if you want them).
            </p>
            <div className="flex gap-2">
              <input
                className={input}
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
                placeholder="price"
              />
              <button onClick={addKeyword} className="rounded-md border border-border px-3 text-sm">
                Add
              </button>
            </div>
            <div className="mt-2">
              {r.keywords.map((k) => (
                <span
                  key={k}
                  className="mr-1 inline-flex items-center gap-1 rounded bg-surface px-2 py-0.5 text-xs border border-border"
                >
                  {k}
                  <button onClick={() => setR({ ...r, keywords: r.keywords.filter((x) => x !== k) })}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {testType === "COMMENT" && (
          <div className="mt-4">
            <label className={label}>Which posts?</label>
            <select
              className={input}
              value={r.mediaScope}
              onChange={(e) =>
                setR({
                  ...r,
                  mediaScope: e.target.value,
                  // Leaving SPECIFIC clears the pinned post so a stale id
                  // can't linger and silently narrow a broader scope.
                  mediaId: e.target.value === "SPECIFIC" ? r.mediaId : null,
                })
              }
            >
              <option value="ALL">
                {platform === "FACEBOOK"
                  ? "All Page posts & ads"
                  : "All posts, reels & ads"}
              </option>
              <option value="ORGANIC">Organic posts only (not ads)</option>
              <option value="ADS">
                Ad posts only (incl. dark posts, auto-covers new ads)
              </option>
              <option value="SPECIFIC">One specific post…</option>
            </select>
            {r.mediaScope === "ADS" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Matches any post currently running as an ad, so new ads are
                covered without editing this rule. Ad posts are usually dark
                posts that never appear in your feed.
              </p>
            )}
            {r.mediaScope === "SPECIFIC" && (
              <div className="mt-2">
                <select
                  className={input}
                  value={r.mediaId ?? ""}
                  onChange={(e) =>
                    setR({ ...r, mediaId: e.target.value || null })
                  }
                >
                  <option value="">Select a post…</option>
                  {media.filter((m) => m.isAd).length > 0 && (
                    <optgroup label="Ad posts">
                      {media
                        .filter((m) => m.isAd)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            [{m.adStatus ?? "AD"}]{" "}
                            {(m.adName || m.caption || m.id).slice(0, 60)}
                          </option>
                        ))}
                    </optgroup>
                  )}
                  {media.filter((m) => !m.isAd).length > 0 && (
                    <optgroup label="Organic posts">
                      {media
                        .filter((m) => !m.isAd)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            [{m.mediaType}] {(m.caption ?? m.id).slice(0, 60)}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
                {mediaError && (
                  <p className="mt-1 text-xs text-danger">{mediaError}</p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {!r.triggerType.startsWith("DM") && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={r.publicReplyEnabled}
                  onChange={(e) => setR({ ...r, publicReplyEnabled: e.target.checked })}
                />
                Public reply to the comment
              </label>
              {r.publicReplyEnabled && (
                <textarea
                  className={input}
                  rows={2}
                  value={r.publicReplyTemplate}
                  onChange={(e) => setR({ ...r, publicReplyTemplate: e.target.value })}
                  placeholder="Thanks {username}! Check your DMs"
                />
              )}
            </>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={r.dmEnabled}
              onChange={(e) => setR({ ...r, dmEnabled: e.target.checked })}
            />
            Send DM
          </label>
          {r.dmEnabled && (
            <>
              <textarea
                className={input}
                rows={3}
                value={r.dmTemplate}
                onChange={(e) => setR({ ...r, dmTemplate: e.target.value })}
                placeholder={"Hey {username}! Here's the link: {link:pricing}"}
              />
              <div className="text-xs text-muted-foreground">
                Variables: {"{username} {comment_text} {message_text} {link:key}"} &mdash;
                links come from the bot profile. Comment&rarr;DM sends ONE message
                only: include the whole offer.
              </div>
            </>
          )}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={r.oncePerUser}
                onChange={(e) => setR({ ...r, oncePerUser: e.target.checked })}
              />
              Only once per user
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={r.aiFallback}
                onChange={(e) => setR({ ...r, aiFallback: e.target.checked })}
              />
              AI writes it if template is empty
            </label>
          </div>
          {r.aiFallback && (
            <div className="mt-3 rounded-md border border-border bg-surface p-3">
              <label className={label}>
                How should the AI reply to THIS rule? (optional)
              </label>
              <textarea
                className={input}
                rows={3}
                value={r.aiInstructions}
                onChange={(e) =>
                  setR({ ...r, aiInstructions: e.target.value })
                }
                placeholder={
                  "e.g. They asked about pricing. Never quote a number - say it depends on scope and invite them to book the free 30-min call. One or two sentences, warm."
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Added on top of the Bot profile for this rule only, and it wins
                on wording. It cannot override the safety guardrails: banned
                topics, the link allowlist, and the no-invented-prices rule
                still apply to whatever the AI writes.
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 rounded-md border border-border p-3">
          <div className="mb-2 text-sm font-medium">When NOT to reply</div>

          <label className={label}>
            Never reply if the message contains (Enter to add)
          </label>
          <div className="flex gap-2">
            <input
              className={input}
              value={negKeywordInput}
              onChange={(e) => setNegKeywordInput(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && (e.preventDefault(), addNegKeyword())
              }
              placeholder="ripoff"
            />
            <button
              onClick={addNegKeyword}
              className="rounded-md border border-border px-3 text-sm"
            >
              Add
            </button>
          </div>
          <div className="mt-2">
            {r.negativeKeywords.map((k) => (
              <span
                key={k}
                className="mr-1 inline-flex items-center gap-1 rounded bg-surface px-2 py-0.5 text-xs border border-border"
              >
                {k}
                <button
                  onClick={() =>
                    setR({
                      ...r,
                      negativeKeywords: r.negativeKeywords.filter(
                        (x) => x !== k,
                      ),
                    })
                  }
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Whole-word, case-insensitive. This rule is skipped entirely when
            one of these appears &mdash; lower-priority rules still get their
            chance.
          </p>

          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={r.skipNoIntent}
              onChange={(e) => setR({ ...r, skipNoIntent: e.target.checked })}
            />
            Skip emoji-only and one-word messages
          </label>
          <p className="ml-6 text-xs text-muted-foreground">
            Ignores &quot;🔥🔥🔥&quot;, &quot;nice&quot;, &quot;wow&quot;,
            &quot;first&quot; and similar &mdash; anything with no question
            and nothing asked for. Multi-word messages always get through.
          </p>

          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={r.aiIntentGuard}
              onChange={(e) => setR({ ...r, aiIntentGuard: e.target.checked })}
            />
            Use AI to skip complaints, spam and praise-only
          </label>
          <p className="ml-6 text-xs text-muted-foreground">
            Costs one extra AI call per message. If the AI isn&apos;t
            confident, or the call fails, the reply is sent anyway &mdash; a
            real question must never be swallowed by an unsure classifier.
          </p>
        </div>

        <div className="mt-4">
          <label className={label}>Meta payload preview</label>
          <pre className="max-h-48 overflow-auto rounded-md bg-surface p-3 text-xs">
            {JSON.stringify(preview, null, 2)}
          </pre>
        </div>

        <div className="mt-4 rounded-md border border-border p-3">
          <label className={label}>Test this rule (dry-run &mdash; nothing is sent)</label>
          <div className="flex gap-2">
            <input
              className={input}
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              placeholder={testType === "COMMENT" ? "a sample comment…" : "a sample DM…"}
            />
            <button
              onClick={dryRun}
              disabled={testing || !testText.trim()}
              className="rounded-md border border-border px-3 text-sm disabled:opacity-50"
            >
              {testing ? "…" : "Run"}
            </button>
          </div>
          {testResult && (
            <div className="mt-2 space-y-1 text-xs">
              {testResult.map((o, i) => (
                <div key={i} className="rounded bg-surface p-2">
                  <b>{o.action}</b>
                  {o.text ? ` — "${o.text}"` : ""}
                  {o.skipReason ? ` (${o.skipReason})` : ""}
                  {o.metaError ? ` — ${o.metaError}` : ""}
                </div>
              ))}
              {testBotOff && (
                <div className="rounded bg-amber-50 p-2 text-amber-800">
                  This is a preview only — the bot is currently{" "}
                  <b>OFF</b>, so real comments and DMs are not being answered
                  yet. Turn it on from the Automation page when you&apos;re
                  ready.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isNew ? "Create rule" : "Save changes"}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </div>
    </div>
  );
}
