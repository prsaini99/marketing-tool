"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";

export interface ProfileFormValues {
  businessDescription: string;
  toneRules: string;
  links: Record<string, string>;
  bannedTopics: string[];
  languageMode: string;
  aiFallbackEnabled: boolean;
  optOutConfirmation: string;
  faqs: Array<{ question: string; answer: string }>;
}

interface LinkRow {
  id: string;
  key: string;
  url: string;
}

let linkRowIdCounter = 0;
function nextLinkRowId(): string {
  linkRowIdCounter += 1;
  return `row-${linkRowIdCounter}`;
}

function seedLinkRows(links: Record<string, string>): LinkRow[] {
  return Object.entries(links).map(([key, url]) => ({ id: nextLinkRowId(), key, url }));
}

export function ProfileForm({
  accountId,
  initial,
}: {
  accountId: string;
  initial: ProfileFormValues;
}) {
  const router = useRouter();
  const [v, setV] = useState<ProfileFormValues>(initial);
  // Links are edited as an ordered array of rows with a stable id, NOT as the
  // Record<string,string> map directly. Editing a row's key while two rows
  // momentarily share a key must not collapse them (last-wins) — that would
  // silently drop a URL from the AI's allowlist. The map is only derived at
  // save time, and duplicate non-blank keys block the save instead.
  const [linkRows, setLinkRows] = useState<LinkRow[]>(() => seedLinkRows(initial.links));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLinkRow(id: string, patch: Partial<Pick<LinkRow, "key" | "url">>) {
    setLinkRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeLinkRow(id: string) {
    setLinkRows((rows) => rows.filter((r) => r.id !== id));
  }

  function addLinkRow() {
    setLinkRows((rows) => [...rows, { id: nextLinkRowId(), key: "", url: "" }]);
  }

  /** Fold rows into the save payload's map, dropping blanks. Returns an error
   *  message instead of a map when two rows share a non-blank key — that is
   *  a user mistake to surface, never to silently resolve. */
  function buildLinksForSave(): { links: Record<string, string> } | { error: string } {
    const links: Record<string, string> = {};
    for (const row of linkRows) {
      const key = row.key.trim();
      const url = row.url.trim();
      if (!key || !url) continue;
      if (Object.prototype.hasOwnProperty.call(links, key)) {
        return { error: `Duplicate link key "${key}". Keys must be unique.` };
      }
      links[key] = url;
    }
    return { links };
  }

  async function save() {
    setError(null);
    setSaved(false);

    const linksResult = buildLinksForSave();
    if ("error" in linksResult) {
      setError(linksResult.error);
      return;
    }

    setSaving(true);
    const payload: ProfileFormValues = { ...v, links: linksResult.links };
    const res = await fetch(`/api/automation/accounts/${accountId}/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Save failed");
      return;
    }
    setV(payload);
    setSaved(true);
    router.refresh();
  }

  const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
  const label = "block text-sm font-medium mb-1";

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <label className={label}>Business description</label>
        <textarea
          className={input}
          rows={4}
          value={v.businessDescription}
          onChange={(e) => setV({ ...v, businessDescription: e.target.value })}
          placeholder="What you sell, who it's for, prices, locations, hours…"
        />
      </div>

      <div>
        <label className={label}>Tone rules</label>
        <textarea
          className={input}
          rows={2}
          value={v.toneRules}
          onChange={(e) => setV({ ...v, toneRules: e.target.value })}
          placeholder="Friendly, short sentences, no emojis except 👍, always offer the link…"
        />
      </div>

      <div>
        <label className={label}>Link library (templates reference {"{link:key}"})</label>
        <div className="space-y-2">
          {linkRows.map((row) => (
            <div key={row.id} className="flex gap-2">
              <input
                className={`${input} w-40`}
                value={row.key}
                placeholder="key"
                onChange={(e) => updateLinkRow(row.id, { key: e.target.value })}
              />
              <input
                className={input}
                value={row.url}
                placeholder="https://…"
                onChange={(e) => updateLinkRow(row.id, { url: e.target.value })}
              />
              <button
                onClick={() => removeLinkRow(row.id)}
                className="text-muted-foreground hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            onClick={addLinkRow}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground"
          >
            <Plus className="h-4 w-4" /> Add link
          </button>
        </div>
      </div>

      <div>
        <label className={label}>FAQs</label>
        <div className="space-y-2">
          {v.faqs.map((f, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={input}
                value={f.question}
                placeholder="Question"
                onChange={(e) => {
                  const faqs = [...v.faqs];
                  faqs[i] = { ...f, question: e.target.value };
                  setV({ ...v, faqs });
                }}
              />
              <input
                className={input}
                value={f.answer}
                placeholder="Answer"
                onChange={(e) => {
                  const faqs = [...v.faqs];
                  faqs[i] = { ...f, answer: e.target.value };
                  setV({ ...v, faqs });
                }}
              />
              <button
                onClick={() => setV({ ...v, faqs: v.faqs.filter((_, j) => j !== i) })}
                className="text-muted-foreground hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setV({ ...v, faqs: [...v.faqs, { question: "", answer: "" }] })}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground"
          >
            <Plus className="h-4 w-4" /> Add FAQ
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className={label}>Banned topics (comma-separated)</label>
          <input
            className={input}
            value={v.bannedTopics.join(", ")}
            onChange={(e) =>
              setV({
                ...v,
                bannedTopics: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              })
            }
            placeholder="politics, competitors, refunds"
          />
        </div>
        <div>
          <label className={label}>Language</label>
          <select
            className={input}
            value={v.languageMode}
            onChange={(e) => setV({ ...v, languageMode: e.target.value })}
          >
            <option value="mirror">Mirror the user&apos;s language</option>
            <option value="en">English only</option>
            <option value="hi">Hindi only</option>
            <option value="es">Spanish only</option>
          </select>
        </div>
      </div>

      <div>
        <label className={label}>Opt-out confirmation message</label>
        <input
          className={input}
          value={v.optOutConfirmation}
          onChange={(e) => setV({ ...v, optOutConfirmation: e.target.value })}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.aiFallbackEnabled}
          onChange={(e) => setV({ ...v, aiFallbackEnabled: e.target.checked })}
        />
        Enable AI fallback when no rule matches (gpt-4o-mini, constrained by this profile)
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save profile
        </button>
        {saved && <span className="text-sm text-green-700">Saved.</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
