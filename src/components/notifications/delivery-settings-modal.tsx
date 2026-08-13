"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, Plus, Send, X } from "lucide-react";

/**
 * Email delivery settings for one ad account.
 *
 * Follows the same portal-modal pattern as AlertsRulesInfo (escape to close,
 * body scroll locked while open) so it feels native next to the rest of the
 * alerts surface.
 *
 * Two deliberate choices worth keeping:
 *
 * 1. Settings load lazily, on open. This modal sits behind a button on a
 *    page that already does real server work; fetching delivery config for
 *    an account nobody is configuring would be waste.
 *
 * 2. "Send test" is split into two actions, because the questions differ:
 *    "does mail reach us at all?" (a short confirmation email) and "does the
 *    real digest look right?" (the actual alert content). The digest preview
 *    deliberately does not advance the delivery cursor server-side, so
 *    previewing never causes tomorrow's real digest to skip those alerts.
 */

interface Settings {
  accountName: string;
  configured: boolean;
  emails: string[];
  alertsEnabled: boolean;
  weeklyEnabled: boolean;
  minSeverity: string;
  lastAlertDigestAt: string | null;
}

const SEVERITIES = [
  { key: "high", label: "High only" },
  { key: "medium", label: "Medium and above" },
  { key: "low", label: "Everything" },
];

export function DeliverySettingsModal({
  adAccountId,
  accountName,
}: {
  adAccountId: string;
  accountName: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<null | "simple" | "digest">(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draftEmail, setDraftEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/notifications/${adAccountId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load settings");
      setSettings(json as Settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [adAccountId]);

  useEffect(() => {
    if (open && !settings) void load();
  }, [open, settings, load]);

  function addEmail() {
    const value = draftEmail.trim().toLowerCase();
    if (!value || !settings) return;
    if (settings.emails.includes(value)) {
      setDraftEmail("");
      return;
    }
    setSettings({ ...settings, emails: [...settings.emails, value] });
    setDraftEmail("");
    setNotice(null);
  }

  function removeEmail(email: string) {
    if (!settings) return;
    setSettings({
      ...settings,
      emails: settings.emails.filter((e) => e !== email),
    });
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/notifications/${adAccountId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          emails: settings.emails,
          alertsEnabled: settings.alertsEnabled,
          weeklyEnabled: settings.weeklyEnabled,
          minSeverity: settings.minSeverity,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save");
      setSettings({ ...settings, ...json });
      setNotice("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(digest: boolean) {
    setTesting(digest ? "digest" : "simple");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/notifications/${adAccountId}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ digest }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Send failed");
      if (digest) {
        setNotice(
          json.status === "sent"
            ? `Digest sent (${json.alertsSent} alert${json.alertsSent === 1 ? "" : "s"}).`
            : `Nothing sent: ${json.reason}.`,
        );
      } else {
        setNotice(`Test email sent to ${json.recipients} recipient(s).`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setTesting(null);
    }
  }

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
    >
      <Mail className="h-3.5 w-3.5" />
      Email delivery
    </button>
  );

  if (!open || !mounted) return trigger;

  return (
    <>
      {trigger}
      {createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Email delivery</h2>
                <p className="mt-0.5 text-xs text-muted">{accountName}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-4 py-4">
              {loading && <p className="text-sm text-muted">Loading…</p>}

              {settings && (
                <>
                  <div>
                    <label className="text-xs font-medium">Recipients</label>
                    <div className="mt-1.5 flex gap-2">
                      <input
                        type="email"
                        value={draftEmail}
                        onChange={(e) => setDraftEmail(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addEmail();
                          }
                        }}
                        placeholder="name@company.com"
                        className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                      />
                      <button
                        type="button"
                        onClick={addEmail}
                        disabled={!draftEmail.trim()}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add
                      </button>
                    </div>
                    {settings.emails.length === 0 ? (
                      <p className="mt-2 text-xs text-muted">
                        No recipients yet, so nothing will be delivered.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {settings.emails.map((email) => (
                          <li
                            key={email}
                            className="flex items-center justify-between rounded border border-border px-2.5 py-1.5 text-sm"
                          >
                            <span className="truncate">{email}</span>
                            <button
                              type="button"
                              onClick={() => removeEmail(email)}
                              className="rounded p-0.5 text-muted hover:text-danger"
                              aria-label={`Remove ${email}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="space-y-2 border-t border-border pt-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={settings.alertsEnabled}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            alertsEnabled: e.target.checked,
                          })
                        }
                      />
                      Daily alert digest
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={settings.weeklyEnabled}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            weeklyEnabled: e.target.checked,
                          })
                        }
                      />
                      Weekly performance report
                    </label>
                  </div>

                  <div className="border-t border-border pt-3">
                    <label className="text-xs font-medium">
                      Only email alerts at or above
                    </label>
                    <select
                      value={settings.minSeverity}
                      onChange={(e) =>
                        setSettings({ ...settings, minSeverity: e.target.value })
                      }
                      className="mt-1.5 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                    >
                      {SEVERITIES.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-xs text-muted">
                      Lower-severity alerts still appear in the dashboard. This
                      only controls what is worth an email.
                    </p>
                  </div>

                  {settings.lastAlertDigestAt && (
                    <p className="text-xs text-muted">
                      Last digest sent{" "}
                      {new Date(settings.lastAlertDigestAt).toLocaleString()}
                    </p>
                  )}

                  {error && <p className="text-xs text-danger">{error}</p>}
                  {notice && <p className="text-xs text-success">{notice}</p>}
                </>
              )}
            </div>

            {settings && (
              <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => sendTest(false)}
                    disabled={testing !== null || settings.emails.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {testing === "simple" ? "Sending…" : "Send test"}
                  </button>
                  <button
                    type="button"
                    onClick={() => sendTest(true)}
                    disabled={testing !== null || settings.emails.length === 0}
                    className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
                  >
                    {testing === "digest" ? "Sending…" : "Preview digest"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
