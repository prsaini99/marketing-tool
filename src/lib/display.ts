/**
 * Display-layer types and label helpers.
 *
 * These are the shapes table/chart components consume. Pages assemble them
 * from real Prisma queries before rendering. Started life as "Mock*" types
 * for the early UI scaffolding; data is 100% real now and the names reflect
 * that.
 *
 * Why centralize: the same table (e.g. CampaignsTable) renders for both the
 * drill-down view and the flat cross-account view. Sharing one display
 * contract keeps the table simple and prevents drift.
 */

// ─── Ad accounts ──────────────────────────────────────────────────────────

export interface DisplayAdAccount {
  id: string; // metaAdAccountId (act_-prefixed)
  businessId: string;
  businessName: string;
  name: string;
  currency: string;
  // null = insights never synced (distinguished from 0 = synced, no spend).
  spend7d: number | null;
  activeCampaigns: number | null;
  status:
    | "ACTIVE"
    | "DISABLED"
    | "UNSETTLED"
    | "PENDING_REVIEW"
    | "CLOSED";
  lastSync: string | null; // pre-formatted relative ("2 min ago") or null
}

// ─── Campaigns ────────────────────────────────────────────────────────────

export interface DisplayCampaign {
  id: string; // metaCampaignId
  adAccountId: string;
  businessId: string;
  businessName: string;
  adAccountName: string;
  currency: string;
  name: string;
  // Meta has many statuses; the common four (ACTIVE/PAUSED/DELETED/ARCHIVED)
  // get styled, the rest fall through to a neutral pill.
  status: string;
  objective: string;
  dailyBudgetCents: number | null;
  lifetimeBudgetCents: number | null;
  // Insights-driven; null until insights sync runs.
  spend7d: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  lastEdited: string; // pre-formatted ("3 days ago", etc.)
}

const KNOWN_OBJECTIVES: Record<string, string> = {
  OUTCOME_SALES: "Sales",
  OUTCOME_LEADS: "Leads",
  OUTCOME_AWARENESS: "Awareness",
  OUTCOME_TRAFFIC: "Traffic",
  OUTCOME_ENGAGEMENT: "Engagement",
  OUTCOME_APP_PROMOTION: "App promotion",
  // Legacy + uncommon real-world objectives Meta still returns:
  LINK_CLICKS: "Link clicks",
  MESSAGES: "Messages",
  POST_ENGAGEMENT: "Post engagement",
  PAGE_LIKES: "Page likes",
  EVENT_RESPONSES: "Event responses",
  APP_INSTALLS: "App installs",
  VIDEO_VIEWS: "Video views",
  LEAD_GENERATION: "Lead generation",
  CONVERSIONS: "Conversions",
  REACH: "Reach",
  BRAND_AWARENESS: "Brand awareness",
};

export function getObjectiveLabel(objective: string): string {
  if (!objective) return "—";
  if (KNOWN_OBJECTIVES[objective]) return KNOWN_OBJECTIVES[objective];
  // Format unknowns: "OUTCOME_FOO_BAR" → "Foo bar"
  return objective
    .replace(/^OUTCOME_/, "")
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

// ─── Ad sets ──────────────────────────────────────────────────────────────

export interface DisplayAdSet {
  id: string; // metaAdSetId
  name: string;
  status: string;
  optimizationGoal: string | null;
  dailyBudgetCents: number | null;
  lifetimeBudgetCents?: number | null;
  // Insights-driven.
  spend7d: number | null;
  impressions: number | null;
  // `results` + `costPerResultCents` require parsing Meta's `actions` field
  // with attribution windows — null until that lands.
  results: number | null;
  costPerResultCents: number | null;
  lastEdited: string;
}

// Flat variant for cross-account ad-set listings (mirrors DisplayCampaign).
// Adds account/business/currency context so the flat table can group and
// the bulk budget modal can compute eligibility per currency.
// Metric fields are null until an insights sync has run.
export interface FlatDisplayAdSet {
  id: string; // metaAdSetId
  adAccountId: string; // act_-prefixed
  businessId: string;
  businessName: string;
  adAccountName: string;
  currency: string;
  campaignName: string;
  campaignId: string; // metaCampaignId
  name: string;
  status: string;
  optimizationGoal: string | null;
  dailyBudgetCents: number | null;
  lifetimeBudgetCents: number | null;
  spend: number | null; // display units (not cents)
  impressions: number | null;
  ctr: number | null; // 0..1
  lastEdited: string;
}

export interface FlatDisplayAd {
  id: string; // metaAdId
  adAccountId: string;
  businessId: string;
  businessName: string;
  adAccountName: string;
  currency: string;
  adSetName: string;
  adSetId: string; // metaAdSetId
  campaignName: string;
  campaignId: string; // metaCampaignId
  name: string;
  status: string;
  format: string | null;
  spend: number | null;
  impressions: number | null;
  ctr: number | null; // 0..1
  lastEdited: string;
}

const KNOWN_OPTIMIZATION_GOALS: Record<string, string> = {
  PURCHASES: "Purchases",
  LINK_CLICKS: "Link clicks",
  LEAD_GENERATION: "Leads",
  REACH: "Reach",
  VIDEO_VIEWS: "Video views",
  APP_INSTALLS: "App installs",
  POST_ENGAGEMENT: "Post engagement",
  PAGE_LIKES: "Page likes",
  IMPRESSIONS: "Impressions",
  THRUPLAY: "ThruPlay",
  LANDING_PAGE_VIEWS: "Landing page views",
  CONVERSATIONS: "Conversations",
  OFFSITE_CONVERSIONS: "Conversions",
};

export function getOptimizationGoalLabel(goal: string | null): string {
  if (!goal) return "—";
  if (KNOWN_OPTIMIZATION_GOALS[goal]) return KNOWN_OPTIMIZATION_GOALS[goal];
  return goal
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

// ─── Ads ──────────────────────────────────────────────────────────────────

export interface DisplayAd {
  id: string; // metaAdId
  name: string;
  status: string;
  format: string | null;
  spend7d: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  lastEdited: string;
}

const KNOWN_AD_FORMATS: Record<string, string> = {
  SINGLE_IMAGE: "Single image",
  VIDEO: "Video",
  CAROUSEL: "Carousel",
  COLLECTION: "Collection",
};

export function getAdFormatLabel(format: string | null): string {
  if (!format) return "—";
  if (KNOWN_AD_FORMATS[format]) return KNOWN_AD_FORMATS[format];
  return format
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

// ─── Insights aggregates ─────────────────────────────────────────────────

export interface DailyMetric {
  date: string; // ISO YYYY-MM-DD
  spend: number; // display units (not cents)
  impressions: number;
  clicks: number;
}

export interface ClientSpend {
  businessId: string;
  name: string;
  spend: number; // display units
  share: number; // 0..1, share of total
}

export interface TopCampaignSpend {
  id: string; // metaCampaignId
  // Unprefixed metaAdAccountId — URL form, used to build the drill-down link.
  adAccountIdUrl: string;
  businessId: string;
  name: string;
  businessName: string;
  spend: number; // display units
}
