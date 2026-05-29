"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Create a custom audience. Four subtypes via a dropdown:
 *
 *   • Customer list — paste emails / phones; hashed + uploaded server-side.
 *   • Website       — pixel rule ("visited" / "URL contains") Meta keeps fresh.
 *   • Lookalike     — clone a source audience in a country at a size ratio.
 *   • Engagement    — people who engaged with a Facebook Page.
 *
 * Each subtype lazy-loads only the resources it needs (pixels / source
 * audiences / pages) when selected, so opening the modal is cheap.
 */

export interface AudienceAccountOption {
  metaAdAccountId: string; // act_-prefixed
  name: string;
  businessName: string;
}

interface CreateAudienceModalProps {
  open: boolean;
  accounts: AudienceAccountOption[];
  onClose: () => void;
}

interface PixelOption {
  id: string;
  name: string;
}
interface PageOption {
  id: string;
  name: string;
}
interface SourceAudienceOption {
  id: string;
  name: string;
  subtype: string | null;
  approximateCount: number | null;
}

type Subtype = "customer_list" | "website" | "lookalike" | "engagement";

const SUBTYPE_OPTIONS: Array<{ value: Subtype; label: string }> = [
  { value: "customer_list", label: "Customer list (emails / phones)" },
  { value: "website", label: "Website traffic (pixel)" },
  { value: "lookalike", label: "Lookalike (clone an audience)" },
  { value: "engagement", label: "Engagement (Facebook Page)" },
];

const RETENTION_PRESETS = [7, 14, 30, 60, 90, 180];
const RATIO_PRESETS = [
  { value: 0.01, label: "1% — most similar" },
  { value: 0.02, label: "2%" },
  { value: 0.03, label: "3%" },
  { value: 0.05, label: "5%" },
  { value: 0.1, label: "10% — broadest" },
];
const ENGAGEMENT_EVENTS: Array<{ value: string; label: string }> = [
  { value: "page_engaged", label: "Engaged with the Page (any)" },
  { value: "page_visited", label: "Visited the Page" },
  { value: "page_messaged", label: "Messaged the Page" },
];

function countEmails(blob: string): { valid: number; total: number } {
  const tokens = blob.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
  const valid = tokens.filter((t) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.toLowerCase()),
  ).length;
  return { valid, total: tokens.length };
}
function countPhones(blob: string): { valid: number; total: number } {
  const tokens = blob.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
  const valid = tokens.filter((t) => t.replace(/\D/g, "").length >= 7).length;
  return { valid, total: tokens.length };
}

export function CreateAudienceModal({
  open,
  accounts,
  onClose,
}: CreateAudienceModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const [subtype, setSubtype] = useState<Subtype>("customer_list");
  const [accountId, setAccountId] = useState(accounts[0]?.metaAdAccountId ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // customer_list
  const [emailsBlob, setEmailsBlob] = useState("");
  const [phonesBlob, setPhonesBlob] = useState("");

  // website
  const [pixelId, setPixelId] = useState("");
  const [urlMode, setUrlMode] = useState<"all" | "contains">("all");
  const [urlContains, setUrlContains] = useState("");

  // shared retention (website + engagement)
  const [retentionDays, setRetentionDays] = useState(30);

  // lookalike
  const [originAudienceId, setOriginAudienceId] = useState("");
  const [country, setCountry] = useState("US");
  const [ratio, setRatio] = useState(0.01);

  // engagement
  const [pageId, setPageId] = useState("");
  const [engagementEvent, setEngagementEvent] = useState("page_engaged");

  // Lazy resources, loaded per subtype
  const [pixels, setPixels] = useState<PixelOption[] | null>(null);
  const [pages, setPages] = useState<PageOption[] | null>(null);
  const [sources, setSources] = useState<SourceAudienceOption[] | null>(null);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLSelectElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setSubtype("customer_list");
    setAccountId(accounts[0]?.metaAdAccountId ?? "");
    setName("");
    setDescription("");
    setEmailsBlob("");
    setPhonesBlob("");
    setPixelId("");
    setUrlMode("all");
    setUrlContains("");
    setRetentionDays(30);
    setOriginAudienceId("");
    setCountry("US");
    setRatio(0.01);
    setPageId("");
    setEngagementEvent("page_engaged");
    setError(null);
    setResult(null);
  }, [open, accounts]);

  // Lazy-load the resource the current subtype needs, on (subtype, account).
  useEffect(() => {
    if (!open || !accountId) return;
    // Customer list needs nothing fetched.
    if (subtype === "customer_list") return;

    let cancelled = false;
    const endpoint =
      subtype === "website"
        ? `/api/pixels?accountId=${encodeURIComponent(accountId)}`
        : subtype === "engagement"
          ? `/api/pages?accountId=${encodeURIComponent(accountId)}`
          : `/api/audiences?accountId=${encodeURIComponent(accountId)}`;

    setResourceLoading(true);
    setResourceError(null);
    setPixels(null);
    setPages(null);
    setSources(null);

    fetch(endpoint)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          pixels?: PixelOption[];
          pages?: PageOption[];
          audiences?: SourceAudienceOption[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setResourceError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        if (subtype === "website") {
          setPixels(data.pixels ?? []);
          if (data.pixels?.[0]) setPixelId(data.pixels[0].id);
        } else if (subtype === "engagement") {
          setPages(data.pages ?? []);
          if (data.pages?.[0]) setPageId(data.pages[0].id);
        } else {
          setSources(data.audiences ?? []);
          if (data.audiences?.[0]) setOriginAudienceId(data.audiences[0].id);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResourceError(err instanceof Error ? err.message : "Failed");
      })
      .finally(() => {
        if (!cancelled) setResourceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, subtype, accountId]);

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
      if (e.key === "Escape" && !submitting) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => firstFieldRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  const emailStats = useMemo(() => countEmails(emailsBlob), [emailsBlob]);
  const phoneStats = useMemo(() => countPhones(phonesBlob), [phonesBlob]);
  const totalValid = emailStats.valid + phoneStats.valid;

  const validationError = (() => {
    if (!accountId) return "Pick an ad account.";
    if (!name.trim()) return "Audience name is required.";
    if (subtype === "customer_list") {
      if (totalValid === 0) return "Add at least one valid email or phone.";
    } else if (subtype === "website") {
      if (pixels && pixels.length === 0) return "This account has no pixels.";
      if (!pixelId) return "Pick a pixel.";
      if (urlMode === "contains" && !urlContains.trim())
        return "Enter the URL fragment to match.";
    } else if (subtype === "lookalike") {
      if (sources && sources.length === 0)
        return "No source audiences — create one first.";
      if (!originAudienceId) return "Pick a source audience.";
      if (!country.trim()) return "Enter a country code.";
    } else if (subtype === "engagement") {
      if (pages && pages.length === 0) return "This account has no pages.";
      if (!pageId) return "Pick a Page.";
    }
    return null;
  })();

  async function submit() {
    if (validationError) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {
        subtype,
        metaAdAccountId: accountId,
        name: name.trim(),
        description: description.trim() || undefined,
      };
      if (subtype === "customer_list") {
        payload.emailsBlob = emailsBlob || undefined;
        payload.phonesBlob = phonesBlob || undefined;
      } else if (subtype === "website") {
        payload.pixelId = pixelId;
        payload.retentionDays = retentionDays;
        payload.urlContains =
          urlMode === "contains" ? urlContains.trim() : undefined;
      } else if (subtype === "lookalike") {
        payload.originAudienceId = originAudienceId;
        payload.country = country.trim().toUpperCase();
        payload.ratio = ratio;
      } else if (subtype === "engagement") {
        payload.pageId = pageId;
        payload.event = engagementEvent;
        payload.retentionDays = retentionDays;
      }
      const res = await fetch("/api/audiences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setResult("Audience created. Meta is processing it now.");
      router.refresh();
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create audience",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-audience-title"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-background shadow-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h2
              id="create-audience-title"
              className="text-sm font-semibold tracking-tight"
            >
              New custom audience
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Pick a source type — each builds a different kind of targetable
              audience.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_280px]">
            <div className="space-y-4 border-b border-border px-5 py-4 lg:border-b-0 lg:border-r">
              {/* Subtype */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Audience source
                </label>
                <select
                  value={subtype}
                  onChange={(e) => setSubtype(e.target.value as Subtype)}
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {SUBTYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Ad account <span className="text-danger">*</span>
                </label>
                <select
                  ref={firstFieldRef}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  disabled={submitting || accounts.length === 0}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {accounts.length === 0 && (
                    <option value="">No accounts available</option>
                  )}
                  {accounts.map((a) => (
                    <option key={a.metaAdAccountId} value={a.metaAdAccountId}>
                      {a.businessName} · {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Audience name <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {/* Subtype-specific fields */}
              {subtype === "customer_list" && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Emails
                    </label>
                    <textarea
                      value={emailsBlob}
                      onChange={(e) => setEmailsBlob(e.target.value)}
                      rows={3}
                      placeholder={"jane@example.com\njohn@example.com"}
                      disabled={submitting}
                      className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Phone numbers
                    </label>
                    <textarea
                      value={phonesBlob}
                      onChange={(e) => setPhonesBlob(e.target.value)}
                      rows={2}
                      placeholder={"+15551234567"}
                      disabled={submitting}
                      className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </>
              )}

              {subtype === "website" && (
                <>
                  <ResourcePicker
                    label="Pixel"
                    loading={resourceLoading}
                    error={resourceError}
                    empty={pixels?.length === 0}
                    emptyHint="No pixels on this account — create one in Events Manager."
                    value={pixelId}
                    onChange={setPixelId}
                    options={(pixels ?? []).map((p) => ({
                      value: p.id,
                      label: `${p.name} (${p.id})`,
                    }))}
                    disabled={submitting}
                  />
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Who to include
                    </label>
                    <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
                      {(
                        [
                          ["all", "All site visitors"],
                          ["contains", "URL contains…"],
                        ] as const
                      ).map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setUrlMode(val)}
                          disabled={submitting}
                          className={cn(
                            "rounded-sm px-2.5 py-1 font-medium transition-colors",
                            urlMode === val
                              ? "bg-surface-2 text-foreground"
                              : "text-muted hover:text-foreground",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {urlMode === "contains" && (
                      <input
                        type="text"
                        value={urlContains}
                        onChange={(e) => setUrlContains(e.target.value)}
                        placeholder="/products"
                        disabled={submitting}
                        className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    )}
                  </div>
                  <RetentionPicker
                    value={retentionDays}
                    onChange={setRetentionDays}
                    disabled={submitting}
                  />
                </>
              )}

              {subtype === "lookalike" && (
                <>
                  <ResourcePicker
                    label="Source audience"
                    loading={resourceLoading}
                    error={resourceError}
                    empty={sources?.length === 0}
                    emptyHint="No source audiences yet — create a customer-list or website audience first."
                    value={originAudienceId}
                    onChange={setOriginAudienceId}
                    options={(sources ?? []).map((s) => ({
                      value: s.id,
                      label: `${s.name}${
                        s.approximateCount != null
                          ? ` · ~${s.approximateCount.toLocaleString()}`
                          : ""
                      }`,
                    }))}
                    disabled={submitting}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground">
                        Country
                      </label>
                      <input
                        type="text"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        placeholder="US"
                        disabled={submitting}
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm uppercase placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground">
                        Audience size
                      </label>
                      <select
                        value={ratio}
                        onChange={(e) => setRatio(Number(e.target.value))}
                        disabled={submitting}
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        {RATIO_PRESETS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-[11px] text-subtle">
                    Meta needs ~100+ matched people in the source audience for
                    the chosen country, or it&apos;ll reject the lookalike.
                  </p>
                </>
              )}

              {subtype === "engagement" && (
                <>
                  <ResourcePicker
                    label="Facebook Page"
                    loading={resourceLoading}
                    error={resourceError}
                    empty={pages?.length === 0}
                    emptyHint="No promotable pages — assign a Page to the System User (setup guide step 6)."
                    value={pageId}
                    onChange={setPageId}
                    options={(pages ?? []).map((p) => ({
                      value: p.id,
                      label: `${p.name} (${p.id})`,
                    }))}
                    disabled={submitting}
                  />
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Engagement type
                    </label>
                    <select
                      value={engagementEvent}
                      onChange={(e) => setEngagementEvent(e.target.value)}
                      disabled={submitting}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      {ENGAGEMENT_EVENTS.map((e) => (
                        <option key={e.value} value={e.value}>
                          {e.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <RetentionPicker
                    value={retentionDays}
                    onChange={setRetentionDays}
                    disabled={submitting}
                  />
                </>
              )}
            </div>

            {/* Summary */}
            <div className="bg-surface px-5 py-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">
                Summary
              </div>
              <div className="mt-3 space-y-1 text-xs text-muted">
                {subtype === "customer_list" && (
                  <p>
                    Uploading{" "}
                    <span className="font-semibold text-foreground">
                      {totalValid}
                    </span>{" "}
                    hashed contact{totalValid === 1 ? "" : "s"} ({emailStats.valid}{" "}
                    email, {phoneStats.valid} phone).
                  </p>
                )}
                {subtype === "website" && (
                  <p>
                    {urlMode === "all"
                      ? "Anyone who visited the site"
                      : `Visited a URL containing "${urlContains || "…"}"`}{" "}
                    in the last{" "}
                    <span className="font-semibold text-foreground">
                      {retentionDays}d
                    </span>
                    .
                  </p>
                )}
                {subtype === "lookalike" && (
                  <p>
                    A{" "}
                    <span className="font-semibold text-foreground">
                      {(ratio * 100).toFixed(0)}%
                    </span>{" "}
                    lookalike in{" "}
                    <span className="font-semibold text-foreground">
                      {country.toUpperCase() || "—"}
                    </span>{" "}
                    of the chosen source.
                  </p>
                )}
                {subtype === "engagement" && (
                  <p>
                    People who{" "}
                    <span className="font-semibold text-foreground">
                      {ENGAGEMENT_EVENTS.find(
                        (e) => e.value === engagementEvent,
                      )?.label ?? engagementEvent}
                    </span>{" "}
                    in the last{" "}
                    <span className="font-semibold text-foreground">
                      {retentionDays}d
                    </span>
                    .
                  </p>
                )}
              </div>
              <div className="mt-3 text-[11px] text-subtle">
                Audit log: audience.create row written
                {subtype === "customer_list" ? " (counts only, no PII)" : ""}.
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3">
          {error && (
            <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
          {result && (
            <div className="mb-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
              {result}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-subtle">
              {validationError ?? "Ready to create."}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || Boolean(validationError)}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {submitting ? "Creating…" : "Create audience"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Shared lazy dropdown for pixel / page / source-audience pickers. */
function ResourcePicker({
  label,
  loading,
  error,
  empty,
  emptyHint,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  loading: boolean;
  error: string | null;
  empty: boolean | undefined;
  emptyHint: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-foreground">
        {label} <span className="text-danger">*</span>
      </label>
      {loading ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading…
        </p>
      ) : error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : empty ? (
        <p className="rounded-md border border-dashed border-border bg-surface px-3 py-2 text-[11px] text-muted">
          {emptyHint}
        </p>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function RetentionPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-foreground">
        Retention (days in audience)
      </label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-40 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {RETENTION_PRESETS.map((d) => (
          <option key={d} value={d}>
            {d} days
          </option>
        ))}
      </select>
    </div>
  );
}
