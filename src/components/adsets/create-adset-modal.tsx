"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ParentCampaign {
  metaCampaignId: string;
  name: string;
  objective: string; // OUTCOME_*
  // Derived: true if the campaign has a budget set at campaign level.
  hasCbo: boolean;
}

interface CreateAdSetModalProps {
  open: boolean;
  campaign: ParentCampaign;
  currency: string;
  // ISO country code for the ad account's market — used as the default
  // targeting country so users don't have to type it every time.
  defaultCountry?: string;
  onClose: () => void;
}

type BudgetType = "daily" | "lifetime";

// Optimization goals we surface per objective. Default is the first one.
const OPTIMIZATION_GOALS: Record<string, Array<{ value: string; label: string }>> = {
  OUTCOME_AWARENESS: [
    { value: "REACH", label: "Reach" },
    { value: "IMPRESSIONS", label: "Impressions" },
    { value: "AD_RECALL_LIFT", label: "Ad recall lift" },
  ],
  OUTCOME_TRAFFIC: [
    { value: "LINK_CLICKS", label: "Link clicks" },
    { value: "LANDING_PAGE_VIEWS", label: "Landing page views" },
    { value: "IMPRESSIONS", label: "Impressions" },
    { value: "REACH", label: "Reach" },
  ],
  OUTCOME_ENGAGEMENT: [
    { value: "POST_ENGAGEMENT", label: "Post engagement" },
    { value: "IMPRESSIONS", label: "Impressions" },
    { value: "REACH", label: "Reach" },
  ],
  OUTCOME_LEADS: [
    { value: "LEAD_GENERATION", label: "Lead generation" },
    { value: "OFFSITE_CONVERSIONS", label: "Offsite conversions" },
  ],
  OUTCOME_SALES: [
    { value: "OFFSITE_CONVERSIONS", label: "Offsite conversions" },
    { value: "VALUE", label: "Value" },
    { value: "REACH", label: "Reach" },
  ],
  OUTCOME_APP_PROMOTION: [
    { value: "APP_INSTALLS", label: "App installs" },
    { value: "OFFSITE_CONVERSIONS", label: "Offsite conversions" },
  ],
};

const FALLBACK_GOALS = [
  { value: "LINK_CLICKS", label: "Link clicks" },
  { value: "REACH", label: "Reach" },
  { value: "IMPRESSIONS", label: "Impressions" },
];

// Which goals need a `promoted_object` on Meta's side, and what flavour.
type PromotedShape = "pixel" | "page" | "app" | null;
function promotedShapeFor(goal: string): PromotedShape {
  if (goal === "OFFSITE_CONVERSIONS" || goal === "VALUE") return "pixel";
  if (goal === "LEAD_GENERATION") return "page";
  if (goal === "APP_INSTALLS") return "app";
  return null;
}

// The Meta "standard events" Pixel can fire. Long-tail goes via custom event
// names, but the standard ones cover ~95% of agency use.
const PIXEL_EVENTS = [
  { value: "PURCHASE", label: "Purchase" },
  { value: "ADD_TO_CART", label: "Add to cart" },
  { value: "INITIATE_CHECKOUT", label: "Initiate checkout" },
  { value: "ADD_PAYMENT_INFO", label: "Add payment info" },
  { value: "COMPLETE_REGISTRATION", label: "Complete registration" },
  { value: "LEAD", label: "Lead" },
  { value: "VIEW_CONTENT", label: "View content" },
  { value: "ADD_TO_WISHLIST", label: "Add to wishlist" },
  { value: "SUBSCRIBE", label: "Subscribe" },
  { value: "CONTACT", label: "Contact" },
];

const FB_POSITIONS = [
  { value: "feed", label: "Facebook Feed" },
  { value: "right_hand_column", label: "Facebook Right Column" },
  { value: "marketplace", label: "Facebook Marketplace" },
];

const IG_POSITIONS = [
  { value: "stream", label: "Instagram Feed" },
  { value: "story", label: "Instagram Story" },
  { value: "reels", label: "Instagram Reels" },
  { value: "explore", label: "Instagram Explore" },
];

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency}`;
  }
}

export function CreateAdSetModal({
  open,
  campaign,
  currency,
  defaultCountry = "IN",
  onClose,
}: CreateAdSetModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goalsForObjective =
    OPTIMIZATION_GOALS[campaign.objective] ?? FALLBACK_GOALS;
  const defaultGoal = goalsForObjective[0]?.value ?? "REACH";

  // ── Form state ────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [optimizationGoal, setOptimizationGoal] = useState(defaultGoal);
  const [budgetType, setBudgetType] = useState<BudgetType>("daily");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // Comma-separated ISO codes; persisted as ["IN", "US", ...].
  const [countriesInput, setCountriesInput] = useState(defaultCountry);
  const [ageMin, setAgeMin] = useState("18");
  const [ageMax, setAgeMax] = useState("65");
  const [gender, setGender] = useState<"all" | "male" | "female">("all");
  const [placementMode, setPlacementMode] = useState<"automatic" | "manual">(
    "automatic",
  );
  const [fbPositions, setFbPositions] = useState<Set<string>>(
    new Set(["feed"]),
  );
  const [igPositions, setIgPositions] = useState<Set<string>>(
    new Set(["stream", "story", "reels"]),
  );
  const [status, setStatus] = useState<"PAUSED" | "ACTIVE">("PAUSED");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Promoted-object inputs. Only the ones matching the current goal's shape
  // are shown/required; the rest stay null and don't get sent.
  const [pixelId, setPixelId] = useState("");
  const [pixelEvent, setPixelEvent] = useState("PURCHASE");
  const [pageId, setPageId] = useState("");
  const [appId, setAppId] = useState("");
  const [appStoreUrl, setAppStoreUrl] = useState("");

  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset on close so reopening is fresh.
  useEffect(() => {
    if (open) return;
    setName("");
    setOptimizationGoal(defaultGoal);
    setBudgetType("daily");
    setBudgetAmount("");
    setStartDate("");
    setEndDate("");
    setCountriesInput(defaultCountry);
    setAgeMin("18");
    setAgeMax("65");
    setGender("all");
    setPlacementMode("automatic");
    setFbPositions(new Set(["feed"]));
    setIgPositions(new Set(["stream", "story", "reels"]));
    setStatus("PAUSED");
    setShowAdvanced(false);
    setPixelId("");
    setPixelEvent("PURCHASE");
    setPageId("");
    setAppId("");
    setAppStoreUrl("");
    setError(null);
  }, [open, defaultGoal, defaultCountry]);

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

  // ── Derived ───────────────────────────────────────────────────────────
  const countries = useMemo(
    () =>
      countriesInput
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
    [countriesInput],
  );
  const budgetCents = (() => {
    const n = Number.parseFloat(budgetAmount);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  })();
  const ageMinNum = Number.parseInt(ageMin, 10);
  const ageMaxNum = Number.parseInt(ageMax, 10);
  const startTimeIso = startDate ? new Date(startDate).toISOString() : null;
  const endTimeIso = endDate ? new Date(endDate).toISOString() : null;

  const promotedShape = promotedShapeFor(optimizationGoal);

  const validationError = (() => {
    if (!name.trim()) return "Ad set name is required.";
    if (countries.length === 0) return "Add at least one country (ISO code).";
    if (!Number.isInteger(ageMinNum) || !Number.isInteger(ageMaxNum)) {
      return "Age min/max must be whole numbers.";
    }
    if (ageMinNum < 13 || ageMaxNum > 65 || ageMinNum > ageMaxNum) {
      return "Age range must be between 13 and 65 (min ≤ max).";
    }
    if (!campaign.hasCbo) {
      if (!budgetCents) return "Parent campaign has no CBO — set a budget here.";
      if (budgetType === "lifetime" && !endTimeIso) {
        return "Lifetime budget needs an end date.";
      }
    } else if (budgetCents) {
      // Defensive — UI hides the budget input when CBO is on.
      return "Parent campaign uses CBO — remove the ad set budget.";
    }
    if (placementMode === "manual") {
      if (fbPositions.size === 0 && igPositions.size === 0) {
        return "Pick at least one Facebook or Instagram placement.";
      }
    }
    if (promotedShape === "pixel") {
      if (!pixelId.trim()) return "Pixel ID is required for conversion goals.";
      if (!pixelEvent) return "Pick a conversion event.";
    }
    if (promotedShape === "page" && !pageId.trim()) {
      return "Facebook Page ID is required for lead generation.";
    }
    if (promotedShape === "app") {
      if (!appId.trim()) return "App ID is required for app promotion.";
      if (!appStoreUrl.trim()) {
        return "App store URL is required for app promotion.";
      }
    }
    return null;
  })();

  // ── Meta payload preview ──────────────────────────────────────────────
  const gendersForPayload =
    gender === "all" ? null : gender === "male" ? [1] : [2];
  const targetingForPayload: Record<string, unknown> = {
    geo_locations: { countries },
    age_min: Number.isFinite(ageMinNum) ? ageMinNum : 18,
    age_max: Number.isFinite(ageMaxNum) ? ageMaxNum : 65,
  };
  if (gendersForPayload) targetingForPayload.genders = gendersForPayload;
  if (placementMode === "manual") {
    const publisherPlatforms: string[] = [];
    if (fbPositions.size > 0) {
      publisherPlatforms.push("facebook");
      targetingForPayload.facebook_positions = Array.from(fbPositions);
    }
    if (igPositions.size > 0) {
      publisherPlatforms.push("instagram");
      targetingForPayload.instagram_positions = Array.from(igPositions);
    }
    if (publisherPlatforms.length > 0) {
      targetingForPayload.publisher_platforms = publisherPlatforms;
    }
  }
  const previewPayload: Record<string, unknown> = {
    name: name || "(empty)",
    campaign_id: campaign.metaCampaignId,
    status,
    optimization_goal: optimizationGoal,
    billing_event: "IMPRESSIONS",
    targeting: targetingForPayload,
  };
  if (!campaign.hasCbo && budgetCents) {
    if (budgetType === "daily") previewPayload.daily_budget = String(budgetCents);
    if (budgetType === "lifetime") previewPayload.lifetime_budget = String(budgetCents);
  }
  if (startTimeIso) previewPayload.start_time = startTimeIso;
  if (endTimeIso) previewPayload.end_time = endTimeIso;
  if (promotedShape === "pixel" && pixelId.trim()) {
    previewPayload.promoted_object = {
      pixel_id: pixelId.trim(),
      custom_event_type: pixelEvent,
    };
  } else if (promotedShape === "page" && pageId.trim()) {
    previewPayload.promoted_object = { page_id: pageId.trim() };
  } else if (
    promotedShape === "app" &&
    appId.trim() &&
    appStoreUrl.trim()
  ) {
    previewPayload.promoted_object = {
      application_id: appId.trim(),
      object_store_url: appStoreUrl.trim(),
    };
  }

  function toggleSet(set: Set<string>, value: string): Set<string> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  async function submit() {
    if (validationError) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/adsets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metaCampaignId: campaign.metaCampaignId,
          name: name.trim(),
          status,
          optimizationGoal,
          budgetType: campaign.hasCbo ? null : budgetType,
          budgetCents: !campaign.hasCbo ? budgetCents : undefined,
          startTime: startTimeIso ?? undefined,
          endTime: endTimeIso ?? undefined,
          targeting: {
            countries,
            ageMin: ageMinNum,
            ageMax: ageMaxNum,
            genders: gendersForPayload,
            placements:
              placementMode === "manual"
                ? {
                    facebookPositions:
                      fbPositions.size > 0 ? Array.from(fbPositions) : undefined,
                    instagramPositions:
                      igPositions.size > 0 ? Array.from(igPositions) : undefined,
                  }
                : null,
          },
          promotedObject:
            promotedShape === "pixel"
              ? { pixelId: pixelId.trim(), customEventType: pixelEvent }
              : promotedShape === "page"
                ? { pageId: pageId.trim() }
                : promotedShape === "app"
                  ? {
                      applicationId: appId.trim(),
                      objectStoreUrl: appStoreUrl.trim(),
                    }
                  : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ad set");
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
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-adset-title"
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-background shadow-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h2
              id="create-adset-title"
              className="text-sm font-semibold tracking-tight"
            >
              New ad set
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Under{" "}
              <span className="font-medium text-foreground">
                {campaign.name}
              </span>{" "}
              · Created as{" "}
              <span className="font-medium text-foreground">PAUSED</span> by
              default.
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
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_320px]">
            {/* ── Form ───────────────────────────────────────────── */}
            <div className="space-y-4 border-b border-border px-5 py-4 lg:border-b-0 lg:border-r">
              {/* Name */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Ad set name <span className="text-danger">*</span>
                </label>
                <input
                  ref={firstFieldRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. India 25-45 women — Diwali Saree"
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {/* Optimization goal */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Optimization goal <span className="text-danger">*</span>
                </label>
                <select
                  value={optimizationGoal}
                  onChange={(e) => setOptimizationGoal(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {goalsForObjective.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-subtle">
                  Defaults to the most common goal for this campaign&apos;s
                  objective. Billing event is IMPRESSIONS.
                </p>
              </div>

              {/* Promoted object — shown only for goals that need one */}
              {promotedShape === "pixel" && (
                <div className="space-y-2 rounded-md border border-border bg-background px-3 py-3">
                  <div className="text-xs font-semibold text-foreground">
                    Promoted object
                  </div>
                  <p className="text-[11px] text-subtle">
                    Conversion goals need a Meta Pixel and the event to optimize for.
                  </p>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Pixel ID <span className="text-danger">*</span>
                    </label>
                    <input
                      type="text"
                      value={pixelId}
                      onChange={(e) => setPixelId(e.target.value)}
                      placeholder="e.g. 1234567890123456"
                      disabled={submitting}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <p className="text-[11px] text-subtle">
                      Find your Pixel ID in Meta Events Manager → Data sources.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Conversion event <span className="text-danger">*</span>
                    </label>
                    <select
                      value={pixelEvent}
                      onChange={(e) => setPixelEvent(e.target.value)}
                      disabled={submitting}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      {PIXEL_EVENTS.map((ev) => (
                        <option key={ev.value} value={ev.value}>
                          {ev.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {promotedShape === "page" && (
                <div className="space-y-2 rounded-md border border-border bg-background px-3 py-3">
                  <div className="text-xs font-semibold text-foreground">
                    Promoted object
                  </div>
                  <p className="text-[11px] text-subtle">
                    Lead generation runs against a specific Facebook Page.
                  </p>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Facebook Page ID <span className="text-danger">*</span>
                    </label>
                    <input
                      type="text"
                      value={pageId}
                      onChange={(e) => setPageId(e.target.value)}
                      placeholder="e.g. 1234567890"
                      disabled={submitting}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
              )}
              {promotedShape === "app" && (
                <div className="space-y-2 rounded-md border border-border bg-background px-3 py-3">
                  <div className="text-xs font-semibold text-foreground">
                    Promoted object
                  </div>
                  <p className="text-[11px] text-subtle">
                    App promotion needs the app id and its store URL.
                  </p>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      App ID <span className="text-danger">*</span>
                    </label>
                    <input
                      type="text"
                      value={appId}
                      onChange={(e) => setAppId(e.target.value)}
                      placeholder="e.g. 1234567890"
                      disabled={submitting}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      App store URL <span className="text-danger">*</span>
                    </label>
                    <input
                      type="text"
                      value={appStoreUrl}
                      onChange={(e) => setAppStoreUrl(e.target.value)}
                      placeholder="https://play.google.com/store/apps/details?id=…"
                      disabled={submitting}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
              )}

              {/* Budget — hidden when parent campaign has CBO */}
              {campaign.hasCbo ? (
                <div className="rounded-md border border-border bg-surface px-3 py-2.5 text-xs">
                  <div className="font-medium text-foreground">
                    Budget inherited from campaign
                  </div>
                  <p className="mt-0.5 text-[11px] text-subtle">
                    Parent campaign uses Advantage Campaign Budget (CBO).
                    Meta will distribute the budget across this ad set
                    automatically.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 rounded-md border border-border bg-background px-3 py-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Budget type
                    </label>
                    <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
                      {(["daily", "lifetime"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setBudgetType(t)}
                          disabled={submitting}
                          className={cn(
                            "rounded-sm px-2.5 py-1 font-medium transition-colors",
                            budgetType === t
                              ? "bg-surface-2 text-foreground"
                              : "text-muted hover:text-foreground",
                          )}
                        >
                          {t === "daily" ? "Daily" : "Lifetime"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Amount ({currency}){" "}
                      <span className="text-danger">*</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={budgetAmount}
                        onChange={(e) => setBudgetAmount(e.target.value)}
                        placeholder="500"
                        disabled={submitting}
                        className="w-40 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <span className="text-xs text-muted">
                        {budgetType === "daily" ? "/ day" : "total"}
                      </span>
                    </div>
                    {budgetCents && (
                      <p className="text-[11px] text-subtle">
                        Sent to Meta as{" "}
                        <span className="font-mono text-foreground">
                          {budgetCents}
                        </span>{" "}
                        ({formatCurrency(budgetCents / 100, currency)}{" "}
                        {budgetType === "daily" ? "/ day" : "lifetime"})
                      </p>
                    )}
                  </div>
                  {budgetType === "lifetime" && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground">
                        End date <span className="text-danger">*</span>
                      </label>
                      <input
                        type="datetime-local"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        disabled={submitting}
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Targeting */}
              <div className="space-y-3 rounded-md border border-border bg-background px-3 py-3">
                <div className="text-xs font-semibold text-foreground">
                  Audience targeting
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    Countries (ISO codes, comma-separated){" "}
                    <span className="text-danger">*</span>
                  </label>
                  <input
                    type="text"
                    value={countriesInput}
                    onChange={(e) => setCountriesInput(e.target.value)}
                    placeholder="IN, US, GB"
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <p className="text-[11px] text-subtle">
                    Defaulted to your account&apos;s region. Use Meta&apos;s 2-letter
                    codes (IN, US, GB, AE, …).
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Min age
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={ageMin}
                      onChange={(e) => setAgeMin(e.target.value)}
                      disabled={submitting}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Max age
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={ageMax}
                      onChange={(e) => setAgeMax(e.target.value)}
                      disabled={submitting}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    Gender
                  </label>
                  <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
                    {(["all", "male", "female"] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setGender(g)}
                        disabled={submitting}
                        className={cn(
                          "rounded-sm px-2.5 py-1 font-medium transition-colors capitalize",
                          gender === g
                            ? "bg-surface-2 text-foreground"
                            : "text-muted hover:text-foreground",
                        )}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Placements */}
              <div className="space-y-3 rounded-md border border-border bg-background px-3 py-3">
                <div className="text-xs font-semibold text-foreground">
                  Placements
                </div>
                <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
                  {(["automatic", "manual"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPlacementMode(m)}
                      disabled={submitting}
                      className={cn(
                        "rounded-sm px-2.5 py-1 font-medium transition-colors capitalize",
                        placementMode === m
                          ? "bg-surface-2 text-foreground"
                          : "text-muted hover:text-foreground",
                      )}
                    >
                      {m === "automatic" ? "Automatic (recommended)" : "Manual"}
                    </button>
                  ))}
                </div>
                {placementMode === "manual" && (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">
                        Facebook
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {FB_POSITIONS.map((p) => {
                          const checked = fbPositions.has(p.value);
                          return (
                            <label
                              key={p.value}
                              className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setFbPositions(toggleSet(fbPositions, p.value))
                                }
                                disabled={submitting}
                                className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-blue-600"
                              />
                              {p.label}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">
                        Instagram
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {IG_POSITIONS.map((p) => {
                          const checked = igPositions.has(p.value);
                          return (
                            <label
                              key={p.value}
                              className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setIgPositions(toggleSet(igPositions, p.value))
                                }
                                disabled={submitting}
                                className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-blue-600"
                              />
                              {p.label}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Advanced — start date + status */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="text-xs text-muted hover:text-foreground"
                >
                  {showAdvanced ? "Hide advanced ▴" : "Show advanced ▾"}
                </button>
                {showAdvanced && (
                  <div className="mt-2 space-y-3 rounded-md border border-border bg-surface px-3 py-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground">
                        Start date (optional)
                      </label>
                      <input
                        type="datetime-local"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        disabled={submitting}
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <p className="text-[11px] text-subtle">
                        Leave blank to start as soon as the ad set is activated.
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground">
                        Start status
                      </label>
                      <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
                        {(["PAUSED", "ACTIVE"] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setStatus(s)}
                            disabled={submitting}
                            className={cn(
                              "rounded-sm px-2.5 py-1 font-medium transition-colors",
                              status === s
                                ? s === "ACTIVE"
                                  ? "bg-red-50 text-red-700"
                                  : "bg-surface-2 text-foreground"
                                : "text-muted hover:text-foreground",
                            )}
                          >
                            {s === "PAUSED" ? "Paused" : "Active"}
                          </button>
                        ))}
                      </div>
                      {status === "ACTIVE" && (
                        <p className="mt-1 flex items-start gap-1 text-[11px] text-danger">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          Ad set won&apos;t actually deliver until at least one
                          ad is created under it AND the campaign is active.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Preview ────────────────────────────────────────── */}
            <div className="bg-surface px-5 py-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">
                Meta payload
              </div>
              <p className="mt-0.5 text-[11px] text-subtle">
                Exactly what hits{" "}
                <span className="font-mono">POST /act_*/adsets</span>.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-background p-3 text-[11px] leading-relaxed text-foreground">
                {JSON.stringify(previewPayload, null, 2)}
              </pre>
              <div className="mt-3 space-y-1 text-[11px] text-subtle">
                <div className="flex justify-between">
                  <span>Parent campaign</span>
                  <span className="text-foreground">
                    {campaign.hasCbo ? "CBO on" : "CBO off"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Audit log</span>
                  <span className="text-foreground">
                    adset.create row written
                  </span>
                </div>
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
              {validationError ?? "Ready to send."}
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
                {submitting
                  ? "Creating…"
                  : status === "PAUSED"
                    ? "Create paused ad set"
                    : "Create active ad set"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
