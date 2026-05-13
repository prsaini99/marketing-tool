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
  metaUpdatedTime: Date | null;
}
