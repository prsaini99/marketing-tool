"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Plug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NormalizedDiscovery } from "@/lib/meta/types";

type Step = "paste" | "picker" | "success";

export default function ConnectBusinessPage() {
  const [step, setStep] = useState<Step>("paste");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");

  const [discovery, setDiscovery] = useState<NormalizedDiscovery | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);

  // Set of unprefixed Meta ad-account ids (matches NormalizedAdAccount.id).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  async function handleDiscover(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/connect/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          label: label.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setDiscovery(data.discovery);
      setConnectionId(data.connectionId);
      setSelectedIds(new Set());
      setStep("picker");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!connectionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/connections/${connectionId}/select`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metaAdAccountIds: Array.from(selectedIds).map((id) => `act_${id}`),
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  function toggleAccount(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBusiness(business: NormalizedDiscovery["businesses"][number]) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected =
        business.adAccounts.length > 0 &&
        business.adAccounts.every((a) => next.has(a.id));
      if (allSelected) {
        for (const a of business.adAccounts) next.delete(a.id);
      } else {
        for (const a of business.adAccounts) next.add(a.id);
      }
      return next;
    });
  }

  const totalAccounts =
    discovery?.businesses.reduce((n, b) => n + b.adAccounts.length, 0) ?? 0;

  // ── Success ───────────────────────────────────────────────────────────
  if (step === "success") {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-lg border border-border bg-background p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
          </div>
          <h1 className="mt-3 text-base font-semibold tracking-tight">
            Connection saved
          </h1>
          <p className="mt-1 text-sm text-muted">
            {selectedIds.size} ad account{selectedIds.size === 1 ? "" : "s"} marked
            for sync.
          </p>
          <p className="mt-3 text-xs text-subtle">
            Sync jobs will populate dashboards once Phase 1 ships.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link
              href="/dashboard/settings"
              className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2 transition-colors"
            >
              View in settings
            </Link>
            <Link
              href="/dashboard/accounts"
              className="inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover transition-colors"
            >
              Go to accounts
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Paste / Picker ────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header>
        <Link
          href="/dashboard/accounts"
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to accounts
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          Connect a Meta business
        </h1>
        <p className="mt-0.5 text-sm text-muted">
          Paste a Meta Marketing API access token. We&apos;ll show what ad accounts it
          can manage, and you pick which to sync.
        </p>
      </header>

      {step === "paste" && (
        <form
          onSubmit={handleDiscover}
          className="space-y-4 rounded-lg border border-border bg-background p-5"
        >
          <div className="space-y-1.5">
            <label htmlFor="label" className="text-xs font-medium">
              Label (optional)
            </label>
            <input
              id="label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Q4 2026, agency-system-user"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <p className="text-[11px] text-subtle">
              Helps you tell connections apart in settings.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="token" className="text-xs font-medium">
              Access token <span className="text-danger">*</span>
            </label>
            <textarea
              id="token"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your Meta Marketing API access token here..."
              rows={4}
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <p className="text-[11px] text-subtle">
              System User tokens are recommended (no expiry). User tokens work too.
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!token.trim() || loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Discovering...
                </>
              ) : (
                <>
                  <Plug className="h-3.5 w-3.5" />
                  Discover
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {step === "picker" && discovery && (
        <>
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted">
            Found{" "}
            <span className="font-medium text-foreground">{totalAccounts}</span> ad
            account{totalAccounts === 1 ? "" : "s"} under{" "}
            <span className="font-medium text-foreground">
              {discovery.businesses.length}
            </span>{" "}
            business{discovery.businesses.length === 1 ? "" : "es"}.
          </div>

          <div className="space-y-3">
            {discovery.businesses.map((b) => {
              const allInBmSelected =
                b.adAccounts.length > 0 &&
                b.adAccounts.every((a) => selectedIds.has(a.id));
              const someInBmSelected = b.adAccounts.some((a) =>
                selectedIds.has(a.id),
              );
              return (
                <div
                  key={b.metaBusinessId}
                  className="overflow-hidden rounded-lg border border-border bg-background"
                >
                  <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded bg-surface-2 text-xs font-semibold text-muted">
                        {b.name[0]}
                      </div>
                      <span className="text-sm font-medium">{b.name}</span>
                      <span className="text-[11px] text-subtle">
                        {b.adAccounts.length} account
                        {b.adAccounts.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {b.adAccounts.length > 0 && (
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={allInBmSelected}
                          ref={(el) => {
                            if (el)
                              el.indeterminate =
                                someInBmSelected && !allInBmSelected;
                          }}
                          onChange={() => toggleBusiness(b)}
                          className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-blue-600"
                        />
                        Select all
                      </label>
                    )}
                  </div>
                  {b.adAccounts.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-subtle">
                      No accessible ad accounts under this business.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {b.adAccounts.map((a) => {
                        const checked = selectedIds.has(a.id);
                        return (
                          <li
                            key={a.id}
                            onClick={() => toggleAccount(a.id)}
                            className={cn(
                              "flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors",
                              checked ? "bg-accent-subtle" : "hover:bg-surface",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleAccount(a.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-blue-600"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {a.name}
                              </p>
                              <p className="truncate text-xs text-subtle">
                                act_{a.id} · {a.currency} · {a.timezone}
                              </p>
                            </div>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                                a.status === "ACTIVE"
                                  ? "bg-green-50 text-green-700"
                                  : "bg-zinc-100 text-zinc-600",
                              )}
                            >
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  a.status === "ACTIVE"
                                    ? "bg-green-500"
                                    : "bg-zinc-400",
                                )}
                              />
                              {a.status === "ACTIVE" ? "Active" : a.status}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setStep("paste")}
              className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted">
                <span className="font-medium text-foreground">
                  {selectedIds.size}
                </span>{" "}
                selected
              </span>
              <button
                type="button"
                onClick={handleSave}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save selection"
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
