/**
 * Normalized types — the contract between the Meta abstraction layer
 * and the rest of the app.
 *
 * The rest of the app NEVER imports types from `facebook-nodejs-business-sdk`.
 * It only uses these. This means when Meta renames a field or changes a
 * response shape, the app keeps compiling — you adapt the mapping in client.ts.
 *
 * Naming conventions:
 * - camelCase, not snake_case (translate Meta's snake_case at the boundary)
 * - Budgets as `Cents` integers, never floats or strings
 * - Dates as ISO 8601 strings, never Meta's various date formats
 */

export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';

export type CampaignObjective =
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_APP_PROMOTION'
  | 'OUTCOME_SALES';

export interface NormalizedAdAccount {
  id: string; // without the `act_` prefix
  name: string;
  currency: string;
  timezone: string;
  status: 'ACTIVE' | 'DISABLED' | 'UNSETTLED' | 'PENDING_REVIEW' | 'CLOSED';
}

export interface NormalizedCampaign {
  id: string;
  name: string;
  status: CampaignStatus | string; // string fallback for new statuses
  objective: CampaignObjective | string; // string fallback for new objectives
  dailyBudgetCents: number | null;
  lifetimeBudgetCents: number | null;
  spendCapCents: number | null;
  metaUpdatedTime: Date | null;
}

export interface CampaignFilters {
  status?: CampaignStatus[];
  limit?: number;
}

// One row from /act_X/insights. Phase 1.2: daily granularity, multiple
// levels (account/campaign/adset/ad). Conversions omitted for now —
// requires parsing the `actions` array with attribution windows (Phase 2).
export interface NormalizedInsight {
  date: string; // ISO 8601 (YYYY-MM-DD)
  level: "account" | "campaign" | "adset" | "ad";
  entityId: string; // Meta id at this level
  impressions: number;
  reach: number;
  clicks: number;
  spendCents: number;
  ctr: number; // 0..1
  cpmCents: number;
}

// Phase 0.5 — returned by metaClient.discoverWithToken().
// Describes everything a freshly-pasted token can see.
export interface NormalizedDiscoveredBusiness {
  metaBusinessId: string;
  name: string;
  adAccounts: NormalizedAdAccount[];
}

export interface NormalizedTokenOwner {
  // Meta's FB id of the token's owner. Used as Connection's natural key —
  // re-pasting any token for the same owner refreshes the existing row.
  id: string;
  name?: string;
}

export interface NormalizedDiscovery {
  tokenOwner: NormalizedTokenOwner;
  businesses: NormalizedDiscoveredBusiness[];
}

// Phase 1.1
export interface NormalizedAdSet {
  id: string;
  campaignMetaId: string; // Meta's parent campaign id, used to look up local FK
  name: string;
  status: string;
  optimizationGoal: string | null;
  dailyBudgetCents: number | null;
  lifetimeBudgetCents: number | null;
  metaUpdatedTime: Date | null;
}

export interface NormalizedAd {
  id: string;
  adSetMetaId: string; // Meta's parent adset id, used to look up local FK
  name: string;
  status: string;
  format: string | null;
  // The creative this ad uses. Meta returns both inline via the
  // `creative{id,thumbnail_url}` field expansion on /act_{id}/ads, so the
  // ad list endpoint already carries everything we need to render a
  // thumbnail without a follow-up call.
  creativeId: string | null;
  creativeThumbnailUrl: string | null;
  metaUpdatedTime: Date | null;
}

// Live estimate of how many people a targeting spec would reach. Returned
// fresh on every call to Meta's /act_{id}/delivery_estimate — we don't
// persist it because the underlying audience drifts hourly and a stale
// number is worse than no number.
//
// `ready=false` means Meta is still computing (shows up for brand-new ad
// accounts or unusually exotic targeting). The bounds are 0 in that case
// and the UI should render a "computing…" hint instead of a real number.
export interface NormalizedReachEstimate {
  lowerBound: number;
  upperBound: number;
  ready: boolean;
}

// One saved custom conversion, pulled from /act_{id}/customconversions.
// A custom conversion is a rule layered on top of Pixel events ("Purchase
// with value > $100", "URL contains /thank-you", …) used as the optimization
// target for conversion-objective ad sets via
// `promoted_object.custom_conversion_id`.
//
// `rule` is intentionally kept as the raw JSON string Meta returns — the
// shape is open-ended (nested and/or branches with various ops) and we
// only display it verbatim, never parse against it.
export interface NormalizedCustomConversion {
  id: string;
  name: string;
  description: string | null;
  rule: string | null;
  customEventType: string | null;     // PURCHASE | LEAD | OTHER | …
  eventSourceId: string | null;       // Meta Pixel id this builds on
  lastFiredTime: Date | null;
  createdTime: Date | null;
}

// One saved audience pulled from /act_{id}/customaudiences. Custom audiences
// are targeting shortcuts — pre-built lists of specific people that ad sets
// can include or exclude (uploaded CRM, pixel visitors, lookalikes, video
// viewers, app users, …). The agency creates these in Ads Manager; we
// mirror the metadata so the Create Ad Set picker can present them in a
// dropdown rather than forcing users to memorize numeric ids.
//
// Meta returns counts as either an integer or the string "1000+" for tiny
// or privacy-bucketed audiences. We coerce the string sentinel to null so
// the UI can render "Less than 1000" cleanly.
export interface NormalizedCustomAudience {
  id: string;
  name: string;
  subtype: string | null;            // CUSTOM | WEBSITE | LOOKALIKE | …
  description: string | null;
  approximateCount: number | null;   // null when bucketed (e.g. "<1000")
  operationStatus: string | null;    // READY | PROCESSING | …
  dataSourceSubtype: string | null;
  createdTime: Date | null;
}

// One video in an ad account's library, returned by /act_{id}/advideos.
// Counterpart to NormalizedAdImage — creatives reference videos by `video_id`.
// `sourceUrl` is the direct mp4; Meta's CDN URL is short-lived so re-fetch
// the row if a previously-stored URL 404s.
export interface NormalizedAdVideo {
  id: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;   // Meta's `picture` field
  sourceUrl: string | null;
  lengthSeconds: number | null;
  status: string | null;          // ready | processing | error
  createdTime: Date | null;
}

// One image in an ad account's library, returned by /act_{id}/adimages.
// Meta's `hash` is the natural id — it's content-addressed, so the same
// pixels uploaded twice produce the same hash. The CDN `url` is short-lived
// and gets refreshed on each sync.
export interface NormalizedAdImage {
  hash: string;
  url: string | null;
  name: string | null;
  width: number | null;
  height: number | null;
  status: string | null;            // ACTIVE | DELETED | INTERNAL
  createdTime: Date | null;
}

// One row from /act_{id}/adcreatives. We deliberately surface a flat
// projection — Meta returns a deeply nested `object_story_spec` containing
// page_id, link_data { call_to_action, link, message, image_hash, … }; the
// service maps the most-displayed leaves up to top level so callers don't
// have to walk the nested shape. Anything genuinely needed in detail view
// (full `asset_feed_spec`, story attachments) can be fetched per-creative
// later.
export interface NormalizedAdCreative {
  id: string;                       // Meta creative id
  name: string | null;
  body: string | null;              // primary text
  title: string | null;             // headline
  linkUrl: string | null;
  imageUrl: string | null;
  imageHash: string | null;
  thumbnailUrl: string | null;
  videoId: string | null;
  callToActionType: string | null;  // SHOP_NOW, LEARN_MORE, …
  status: string | null;            // ACTIVE | IN_PROCESS | WITH_ISSUES | DELETED
  effectiveStoryId: string | null;
  pageId: string | null;
  instagramActorId: string | null;
  objectType: string | null;        // SHARE | VIDEO | PHOTO | …
}

// Live financial / health snapshot for an ad account, pulled directly from
// `/act_{id}?fields=…` at request time. NOT persisted — these values move on
// Meta's side as soon as ads spend or a top-up clears, and caching a stale
// balance is worse than missing the section entirely.
//
// Money fields are in the account currency's smallest unit (cents).
//   - `balanceCents` is the OUTSTANDING amount owed for delivered ads
//     (post-pay accounts). `0` for accounts on a prepaid balance.
//   - `spendCapCents = null` means no cap configured (most agency accounts).
//   - `amountSpentCents` is lifetime spend within the current billing cycle's
//     cap window — useful next to `spendCapCents` to show how close to the cap.
//   - `minDailyBudgetCents` varies by currency + objective; Meta enforces it
//     when creating ad sets, so showing it here saves a trial-and-error round.
//   - `disableReason` is `null` when account is healthy; otherwise a stable
//     code string the UI maps to a human label + remediation hint.
export interface NormalizedAdAccountDetail {
  balanceCents: number;
  spendCapCents: number | null;
  amountSpentCents: number;
  minDailyBudgetCents: number | null;
  fundingSourceId: string | null;
  businessCountryCode: string | null;
  disableReason: string | null;
}
