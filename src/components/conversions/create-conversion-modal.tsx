"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";

/**
 * Create a custom conversion. Pick an account + pixel, name it, choose the
 * event category, and define the matching rule (URL contains/equals, or an
 * event name). Right pane shows the exact rule JSON + payload that hits Meta.
 *
 * Pixels load lazily from GET /api/pixels when the account changes — a
 * custom conversion is always built on top of a pixel (event_source_id).
 */

export interface ConversionAccountOption {
  metaAdAccountId: string; // act_-prefixed
  name: string;
  businessName: string;
}

interface CreateConversionModalProps {
  open: boolean;
  accounts: ConversionAccountOption[];
  onClose: () => void;
}

interface PixelOption {
  id: string;
  name: string;
}

type RuleType = "url_contains" | "url_equals" | "event_equals";

// Meta's custom_event_type categories — the common set agencies use.
const EVENT_TYPES = [
  { value: "PURCHASE", label: "Purchase" },
  { value: "LEAD", label: "Lead" },
  { value: "COMPLETE_REGISTRATION", label: "Complete registration" },
  { value: "ADD_TO_CART", label: "Add to cart" },
  { value: "INITIATE_CHECKOUT", label: "Initiate checkout" },
  { value: "ADD_PAYMENT_INFO", label: "Add payment info" },
  { value: "CONTENT_VIEW", label: "Content view" },
  { value: "SEARCH", label: "Search" },
  { value: "SUBSCRIBE", label: "Subscribe" },
  { value: "START_TRIAL", label: "Start trial" },
  { value: "CONTACT", label: "Contact" },
  { value: "OTHER", label: "Other / custom" },
];

function buildRulePreview(ruleType: RuleType, value: string) {
  const v = value.trim() || "…";
  switch (ruleType) {
    case "url_contains":
      return { url: { i_contains: v } };
    case "url_equals":
      return { url: { i_eq: v } };
    case "event_equals":
      return { event: { eq: v } };
  }
}

export function CreateConversionModal({
  open,
  accounts,
  onClose,
}: CreateConversionModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [accountId, setAccountId] = useState(
    accounts[0]?.metaAdAccountId ?? "",
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [customEventType, setCustomEventType] = useState("PURCHASE");
  const [ruleType, setRuleType] = useState<RuleType>("url_contains");
  const [ruleValue, setRuleValue] = useState("");
  const [pixelId, setPixelId] = useState("");

  const [pixels, setPixels] = useState<PixelOption[] | null>(null);
  const [pixelsLoading, setPixelsLoading] = useState(false);
  const [pixelsError, setPixelsError] = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLSelectElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setAccountId(accounts[0]?.metaAdAccountId ?? "");
    setName("");
    setDescription("");
    setCustomEventType("PURCHASE");
    setRuleType("url_contains");
    setRuleValue("");
    setPixelId("");
    setError(null);
  }, [open, accounts]);

  // Load pixels whenever the account changes (or modal opens).
  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    setPixelsLoading(true);
    setPixelsError(null);
    setPixels(null);
    fetch(`/api/pixels?accountId=${encodeURIComponent(accountId)}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          pixels?: PixelOption[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setPixelsError(data.error ?? `HTTP ${res.status}`);
          setPixels([]);
          return;
        }
        setPixels(data.pixels ?? []);
        // Auto-select the first pixel so the form is usable in one glance.
        if (data.pixels && data.pixels.length > 0) {
          setPixelId(data.pixels[0].id);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPixelsError(err instanceof Error ? err.message : "Failed");
        setPixels([]);
      })
      .finally(() => {
        if (!cancelled) setPixelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, accountId]);

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

  const rulePreview = useMemo(
    () => buildRulePreview(ruleType, ruleValue),
    [ruleType, ruleValue],
  );

  const isUrlRule = ruleType === "url_contains" || ruleType === "url_equals";

  const validationError = (() => {
    if (!accountId) return "Pick an ad account.";
    if (!name.trim()) return "Conversion name is required.";
    if (pixels && pixels.length === 0) return "This account has no pixels.";
    if (!pixelId) return "Pick a pixel.";
    if (!ruleValue.trim()) {
      return isUrlRule ? "Enter a URL value." : "Enter an event name.";
    }
    return null;
  })();

  async function submit() {
    if (validationError) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metaAdAccountId: accountId,
          name: name.trim(),
          description: description.trim() || undefined,
          pixelId,
          customEventType,
          ruleType,
          ruleValue: ruleValue.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create conversion",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted || !open) return null;

  const payloadPreview = {
    name: name || "(empty)",
    event_source_id: pixelId || "(pick a pixel)",
    custom_event_type: customEventType,
    rule: rulePreview,
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-conversion-title"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-background shadow-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h2
              id="create-conversion-title"
              className="text-sm font-semibold tracking-tight"
            >
              New custom conversion
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              A rule on top of a pixel&apos;s events — used as an
              optimization target on conversion ad sets.
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
            {/* Form */}
            <div className="space-y-4 border-b border-border px-5 py-4 lg:border-b-0 lg:border-r">
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
                  Pixel <span className="text-danger">*</span>
                </label>
                {pixelsLoading ? (
                  <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading pixels…
                  </p>
                ) : pixelsError ? (
                  <p className="text-xs text-danger">{pixelsError}</p>
                ) : pixels && pixels.length > 0 ? (
                  <select
                    value={pixelId}
                    onChange={(e) => setPixelId(e.target.value)}
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {pixels.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.id})
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="rounded-md border border-dashed border-border bg-surface px-3 py-2 text-[11px] text-muted">
                    No pixels on this account. Create one in Meta Events
                    Manager first — a custom conversion needs a pixel.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Conversion name <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Thank-you page visits"
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Event category
                </label>
                <select
                  value={customEventType}
                  onChange={(e) => setCustomEventType(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-subtle">
                  How Meta categorizes this conversion for reporting +
                  optimization.
                </p>
              </div>

              {/* Rule builder */}
              <div className="space-y-2 rounded-md border border-border bg-background px-3 py-3">
                <div className="text-xs font-semibold text-foreground">
                  Matching rule
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    Rule type
                  </label>
                  <select
                    value={ruleType}
                    onChange={(e) => setRuleType(e.target.value as RuleType)}
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    <option value="url_contains">URL contains</option>
                    <option value="url_equals">URL equals</option>
                    <option value="event_equals">Event name equals</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    {isUrlRule ? "URL value" : "Event name"}{" "}
                    <span className="text-danger">*</span>
                  </label>
                  <input
                    type="text"
                    value={ruleValue}
                    onChange={(e) => setRuleValue(e.target.value)}
                    placeholder={
                      ruleType === "url_contains"
                        ? "/thank-you"
                        : ruleType === "url_equals"
                          ? "https://example.com/thank-you"
                          : "Purchase"
                    }
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <p className="text-[11px] text-subtle">
                    {ruleType === "url_contains" &&
                      "Fires when the visited URL contains this text."}
                    {ruleType === "url_equals" &&
                      "Fires when the visited URL exactly matches this."}
                    {ruleType === "event_equals" &&
                      "Fires when the pixel reports this standard/custom event."}
                  </p>
                </div>
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
            </div>

            {/* Preview */}
            <div className="bg-surface px-5 py-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">
                Meta payload
              </div>
              <p className="mt-0.5 text-[11px] text-subtle">
                Hits{" "}
                <span className="font-mono">
                  POST /act_*/customconversions
                </span>
                .
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-background p-3 text-[11px] leading-relaxed text-foreground">
                {JSON.stringify(payloadPreview, null, 2)}
              </pre>
              <div className="mt-3 text-[11px] text-subtle">
                Audit log: conversion.create row written.
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
                {submitting ? "Creating…" : "Create conversion"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
