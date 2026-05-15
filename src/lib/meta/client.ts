/**
 * Meta API Client — the ONLY place in the codebase that talks to Meta.
 *
 * Phase 0.5 uses `fetch` against Graph API v23.0 directly. The SDK is overkill
 * for our current call set (two GET endpoints) and adds debugging friction.
 * The SDK may earn its keep later when we paginate campaigns/insights at scale.
 *
 * Rules:
 * 1. Public methods accept either a raw token (only `discoverWithToken`, before
 *    the token is stored) or a connectionId. Raw tokens never leave this file.
 * 2. Public methods return NORMALIZED types from ./types.ts. UI and services
 *    never see Meta's raw response shape — this isolates Meta-API churn.
 * 3. Write operations log to AuditLog (none in Phase 0.5; placeholder).
 */

import { getCredential } from "./credentials";
import type {
  NormalizedAd,
  NormalizedAdAccount,
  NormalizedAdSet,
  NormalizedCampaign,
  NormalizedDiscoveredBusiness,
  NormalizedDiscovery,
  NormalizedInsight,
} from "./types";

// Pin the API version explicitly. Update deliberately, with a PR, after testing.
const META_API_VERSION = "v23.0";
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export class MetaApiError extends Error {
  constructor(
    message: string,
    public httpStatus: number,
    public metaCode?: number,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

interface RawMetaError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  // Meta's user-friendly fields — usually MUCH more specific than `message`,
  // which is often just "Invalid parameter" for 400s.
  error_user_title?: string;
  error_user_msg?: string;
}

/**
 * Read Meta's error payload from a non-OK response and produce a message
 * that's actually useful in the UI. Meta wraps the real reason in
 * `error_user_msg` while `message` stays generic — surface the most
 * specific field available.
 */
async function readMetaError(res: Response): Promise<{
  message: string;
  code?: number;
}> {
  let metaErr: RawMetaError | undefined;
  try {
    const body = await res.json();
    metaErr = body?.error;
  } catch {
    // Non-JSON body — caller falls back to HTTP status.
  }
  if (!metaErr) {
    return { message: `Meta API returned ${res.status}` };
  }
  const parts: string[] = [];
  // Most specific first.
  if (metaErr.error_user_title && metaErr.error_user_msg) {
    parts.push(`${metaErr.error_user_title}: ${metaErr.error_user_msg}`);
  } else if (metaErr.error_user_msg) {
    parts.push(metaErr.error_user_msg);
  } else if (metaErr.error_user_title) {
    parts.push(metaErr.error_user_title);
  } else if (metaErr.message) {
    parts.push(metaErr.message);
  }
  if (metaErr.error_subcode) {
    parts.push(`(code ${metaErr.code}/${metaErr.error_subcode})`);
  } else if (metaErr.code) {
    parts.push(`(code ${metaErr.code})`);
  }
  return {
    message: parts.join(" ") || `Meta API returned ${res.status}`,
    code: metaErr.code,
  };
}

interface MetaPagedResponse<T> {
  data: T[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
  };
}

interface RawBusiness {
  id: string;
  name: string;
}

interface RawAdAccount {
  id: string;          // e.g. "act_1234567890"
  account_id: string;  // e.g. "1234567890" (no prefix)
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
}

async function metaGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`${META_API_BASE}${path}`);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const { message, code } = await readMetaError(res);
    throw new MetaApiError(message, res.status, code);
  }
  return res.json() as Promise<T>;
}

// Meta's account_status is a numeric code; map to our normalized string.
// https://developers.facebook.com/docs/marketing-api/reference/ad-account/#fields
function normalizeAccountStatus(code: number): NormalizedAdAccount["status"] {
  switch (code) {
    case 1:
      return "ACTIVE";
    case 2:
      return "DISABLED";
    case 3:
      return "UNSETTLED";
    case 7:
      return "PENDING_REVIEW";
    case 9:
    case 100:
    case 101:
    case 102:
      return "CLOSED";
    default:
      return "ACTIVE";
  }
}

function normalizeAdAccount(raw: RawAdAccount): NormalizedAdAccount {
  return {
    id: raw.account_id, // store the unprefixed form; we prefix back when calling Meta
    name: raw.name,
    currency: raw.currency,
    timezone: raw.timezone_name ?? "UTC", // some endpoints omit it; default sensibly
    status: normalizeAccountStatus(raw.account_status),
  };
}

class MetaClient {
  /**
   * Enumerate every BM + ad account a token can see. Used by the connect
   * flow BEFORE the token is stored, so this takes a raw token.
   *
   * Two paths combined:
   * 1. `/me/businesses` → BMs → owned + client ad accounts under each
   * 2. `/me/adaccounts` → ad accounts directly accessible (system-user tokens
   *    and partner-share tokens commonly have this but no BM-level access).
   *    Any direct accounts not already covered by a BM in (1) get bundled
   *    under a synthetic "<token-name> (direct access)" business so the
   *    data model stays consistent (everything under a business).
   */
  async discoverWithToken(rawToken: string): Promise<NormalizedDiscovery> {
    const accountFields =
      "id,account_id,name,currency,timezone_name,account_status";

    const [bizResp, directResp, me] = await Promise.all([
      metaGet<MetaPagedResponse<RawBusiness>>("/me/businesses", rawToken, {
        fields: "id,name",
        limit: "100",
      }).catch(() => ({ data: [] as RawBusiness[] })),
      metaGet<MetaPagedResponse<RawAdAccount>>("/me/adaccounts", rawToken, {
        fields: accountFields,
        limit: "100",
      }).catch(() => ({ data: [] as RawAdAccount[] })),
      metaGet<{ id: string; name?: string }>("/me", rawToken, {
        fields: "id,name",
      }).catch(() => ({ id: "unknown", name: undefined as string | undefined })),
    ]);

    // Path 1: BMs + their ad accounts.
    const businessesFromBMs: NormalizedDiscoveredBusiness[] = await Promise.all(
      bizResp.data.map(async (b) => {
        const [owned, client] = await Promise.all([
          metaGet<MetaPagedResponse<RawAdAccount>>(
            `/${b.id}/owned_ad_accounts`,
            rawToken,
            { fields: accountFields, limit: "100" },
          ).catch(() => ({ data: [] as RawAdAccount[] })),
          metaGet<MetaPagedResponse<RawAdAccount>>(
            `/${b.id}/client_ad_accounts`,
            rawToken,
            { fields: accountFields, limit: "100" },
          ).catch(() => ({ data: [] as RawAdAccount[] })),
        ]);

        // Dedupe — a BM can both own and have client-access to the same account.
        const seen = new Set<string>();
        const merged = [...owned.data, ...client.data].filter((a) => {
          if (seen.has(a.account_id)) return false;
          seen.add(a.account_id);
          return true;
        });

        return {
          metaBusinessId: b.id,
          name: b.name,
          adAccounts: merged.map(normalizeAdAccount),
        };
      }),
    );

    // Path 2: orphan direct ad accounts (not under any discovered BM).
    const idsCoveredByBMs = new Set<string>();
    for (const bm of businessesFromBMs) {
      for (const a of bm.adAccounts) idsCoveredByBMs.add(a.id);
    }
    const orphans = directResp.data.filter(
      (a) => !idsCoveredByBMs.has(a.account_id),
    );

    const businesses = [...businessesFromBMs];
    if (orphans.length > 0) {
      businesses.push({
        metaBusinessId: `direct_${me.id}`,
        name: me.name ? `${me.name} (direct access)` : "Direct access",
        adAccounts: orphans.map(normalizeAdAccount),
      });
    }

    return {
      tokenOwner: { id: me.id, name: me.name },
      businesses,
    };
  }

  /**
   * List campaigns under an ad account. Takes a connectionId so we decrypt
   * the right token internally — callers never handle raw tokens.
   *
   * Phase 1.0: returns at most 200 campaigns (single page). Most accounts
   * fit. Pagination via `paging.next` is a follow-up if a real account ever
   * exceeds this.
   */
  async listCampaigns(
    connectionId: string,
    metaAdAccountId: string,
  ): Promise<NormalizedCampaign[]> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;

    const resp = await metaGet<MetaPagedResponse<RawCampaign>>(
      `/${acctId}/campaigns`,
      accessToken,
      {
        fields:
          "id,name,status,objective,daily_budget,lifetime_budget,updated_time",
        limit: "200",
      },
    );

    return resp.data.map(normalizeCampaign);
  }

  /** List ad sets for an ad account. Each one carries its parent campaign id. */
  async listAdSets(
    connectionId: string,
    metaAdAccountId: string,
  ): Promise<NormalizedAdSet[]> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;
    const resp = await metaGet<MetaPagedResponse<RawAdSet>>(
      `/${acctId}/adsets`,
      accessToken,
      {
        fields:
          "id,name,status,optimization_goal,daily_budget,lifetime_budget,updated_time,campaign_id",
        limit: "200",
      },
    );
    return resp.data.map(normalizeAdSet);
  }

  /** List ads for an ad account. Each one carries its parent ad set id. */
  async listAds(
    connectionId: string,
    metaAdAccountId: string,
  ): Promise<NormalizedAd[]> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;
    const resp = await metaGet<MetaPagedResponse<RawAd>>(
      `/${acctId}/ads`,
      accessToken,
      {
        fields: "id,name,status,updated_time,adset_id",
        limit: "200",
      },
    );
    return resp.data.map(normalizeAd);
  }

  /**
   * Change a campaign's budget on Meta. Cents in the account currency.
   *
   * `budgetType` picks which field is updated:
   *   - "daily"    → ?daily_budget=<cents>
   *   - "lifetime" → ?lifetime_budget=<cents>
   *
   * A campaign uses ONE budget type at a time. Don't try to switch
   * (e.g. daily → lifetime) here — Meta requires unsetting the other
   * field first, and that's an explicit Phase 2+ flow.
   *
   * Returns void on success; throws MetaApiError on failure.
   */
  async updateCampaignBudget(
    connectionId: string,
    metaCampaignId: string,
    budgetType: "daily" | "lifetime",
    cents: number,
  ): Promise<void> {
    if (!Number.isFinite(cents) || cents <= 0) {
      throw new Error("cents must be a positive integer");
    }
    const { accessToken } = await getCredential(connectionId);
    const url = new URL(`${META_API_BASE}/${metaCampaignId}`);
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set(
      budgetType === "daily" ? "daily_budget" : "lifetime_budget",
      String(Math.round(cents)),
    );

    const res = await fetch(url.toString(), { method: "POST" });
    if (!res.ok) {
      const { message, code } = await readMetaError(res);
      throw new MetaApiError(message, res.status, code);
    }
  }

  /**
   * Change a campaign's status on Meta. The ONLY write to Meta the platform
   * currently performs — all other endpoints in this client are GETs.
   *
   * Status mapping:
   *   pause    → PAUSED
   *   activate → ACTIVE
   *   archive  → ARCHIVED   (Meta's soft-delete; recoverable)
   *
   * Meta uses the empty-body POST with the new status as a query param:
   *   POST /v23.0/{campaign_id}?status=PAUSED&access_token=...
   */
  async updateCampaignStatus(
    connectionId: string,
    metaCampaignId: string,
    newStatus: "PAUSED" | "ACTIVE" | "ARCHIVED",
  ): Promise<void> {
    const { accessToken } = await getCredential(connectionId);
    const url = new URL(`${META_API_BASE}/${metaCampaignId}`);
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("status", newStatus);

    const res = await fetch(url.toString(), { method: "POST" });
    if (!res.ok) {
      const { message, code } = await readMetaError(res);
      throw new MetaApiError(message, res.status, code);
    }
  }

  /**
   * Create a new campaign on Meta under the given ad account.
   *
   * The payload is the field set the caller wants to send — we forward it
   * verbatim as URL-encoded params (Meta's POST endpoints accept query-string
   * form, no JSON body). Object values are JSON-stringified (Meta does this
   * for `special_ad_categories` and a few others).
   *
   * Returns the new campaign's Meta id on success. Throws MetaApiError on
   * any 4xx/5xx so the service layer can surface the message and stamp the
   * audit row as failed.
   */
  async createCampaign(
    connectionId: string,
    metaAdAccountId: string,
    payload: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;
    const url = new URL(`${META_API_BASE}/${acctId}/campaigns`);
    url.searchParams.set("access_token", accessToken);
    for (const [key, value] of Object.entries(payload)) {
      if (value == null) continue;
      if (typeof value === "object") {
        url.searchParams.set(key, JSON.stringify(value));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    const res = await fetch(url.toString(), { method: "POST" });
    if (!res.ok) {
      const { message, code } = await readMetaError(res);
      throw new MetaApiError(message, res.status, code);
    }
    return res.json() as Promise<{ id: string }>;
  }

  /**
   * Create a new ad set on Meta under the given ad account.
   *
   * Mirrors createCampaign — payload is forwarded as URL-encoded params,
   * objects (`targeting`, `attribution_spec`) get JSON-stringified. The
   * service layer is responsible for shaping the payload to match the
   * parent campaign's constraints (e.g., no budget when campaign has CBO).
   */
  async createAdSet(
    connectionId: string,
    metaAdAccountId: string,
    payload: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;
    const url = new URL(`${META_API_BASE}/${acctId}/adsets`);
    url.searchParams.set("access_token", accessToken);
    for (const [key, value] of Object.entries(payload)) {
      if (value == null) continue;
      if (typeof value === "object") {
        url.searchParams.set(key, JSON.stringify(value));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    const res = await fetch(url.toString(), { method: "POST" });
    if (!res.ok) {
      const { message, code } = await readMetaError(res);
      throw new MetaApiError(message, res.status, code);
    }
    return res.json() as Promise<{ id: string }>;
  }

  /**
   * Upload an image to Meta's ad library and return the resulting image_hash.
   *
   * Meta exposes `POST /act_{id}/adimages` as multipart/form-data with the
   * file under the `source` field. The response is keyed by filename:
   *   { images: { "foo.jpg": { hash: "abc123…", url: "https://…" } } }
   *
   * The hash is what creative specs reference via
   * `link_data.image_hash` — same image can be reused across many ads.
   *
   * Throws MetaApiError on any non-OK response so the service can stamp
   * the audit row + abort before the dependent ad-create call fires.
   */
  async uploadAdImage(
    connectionId: string,
    metaAdAccountId: string,
    file: Blob,
    filename: string,
  ): Promise<{ hash: string; url?: string }> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;
    const url = new URL(`${META_API_BASE}/${acctId}/adimages`);
    url.searchParams.set("access_token", accessToken);

    const form = new FormData();
    form.append("source", file, filename);

    const res = await fetch(url.toString(), {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const { message, code } = await readMetaError(res);
      throw new MetaApiError(message, res.status, code);
    }
    const body = (await res.json()) as {
      images?: Record<string, { hash?: string; url?: string }>;
    };
    // Response is keyed by filename — grab whatever's first.
    const first = body.images ? Object.values(body.images)[0] : undefined;
    if (!first?.hash) {
      throw new MetaApiError(
        "Meta did not return an image_hash",
        res.status,
      );
    }
    return { hash: first.hash, url: first.url };
  }

  /**
   * Create a new ad on Meta. Caller is responsible for shaping the creative
   * payload (object_story_spec or creative_id reference) — we forward as-is.
   */
  async createAd(
    connectionId: string,
    metaAdAccountId: string,
    payload: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;
    const url = new URL(`${META_API_BASE}/${acctId}/ads`);
    url.searchParams.set("access_token", accessToken);
    for (const [key, value] of Object.entries(payload)) {
      if (value == null) continue;
      if (typeof value === "object") {
        url.searchParams.set(key, JSON.stringify(value));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    const res = await fetch(url.toString(), { method: "POST" });
    if (!res.ok) {
      const { message, code } = await readMetaError(res);
      throw new MetaApiError(message, res.status, code);
    }
    return res.json() as Promise<{ id: string }>;
  }

  /**
   * Change an ad set's budget on Meta. Cents in the account currency.
   * Mirrors updateCampaignBudget but targets /{adset_id}.
   */
  async updateAdSetBudget(
    connectionId: string,
    metaAdSetId: string,
    budgetType: "daily" | "lifetime",
    cents: number,
  ): Promise<void> {
    if (!Number.isFinite(cents) || cents <= 0) {
      throw new Error("cents must be a positive integer");
    }
    const { accessToken } = await getCredential(connectionId);
    const url = new URL(`${META_API_BASE}/${metaAdSetId}`);
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set(
      budgetType === "daily" ? "daily_budget" : "lifetime_budget",
      String(Math.round(cents)),
    );
    const res = await fetch(url.toString(), { method: "POST" });
    if (!res.ok) {
      const { message, code } = await readMetaError(res);
      throw new MetaApiError(message, res.status, code);
    }
  }

  /** Change an ad set's status on Meta. Mirrors updateCampaignStatus. */
  async updateAdSetStatus(
    connectionId: string,
    metaAdSetId: string,
    newStatus: "PAUSED" | "ACTIVE" | "ARCHIVED",
  ): Promise<void> {
    const { accessToken } = await getCredential(connectionId);
    const url = new URL(`${META_API_BASE}/${metaAdSetId}`);
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("status", newStatus);
    const res = await fetch(url.toString(), { method: "POST" });
    if (!res.ok) {
      const { message, code } = await readMetaError(res);
      throw new MetaApiError(message, res.status, code);
    }
  }

  /** Change an ad's status on Meta. Mirrors updateCampaignStatus. */
  async updateAdStatus(
    connectionId: string,
    metaAdId: string,
    newStatus: "PAUSED" | "ACTIVE" | "ARCHIVED",
  ): Promise<void> {
    const { accessToken } = await getCredential(connectionId);
    const url = new URL(`${META_API_BASE}/${metaAdId}`);
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("status", newStatus);
    const res = await fetch(url.toString(), { method: "POST" });
    if (!res.ok) {
      const { message, code } = await readMetaError(res);
      throw new MetaApiError(message, res.status, code);
    }
  }

  /**
   * Fetch ad previews across multiple placement formats in one shot.
   *
   * Meta's `/{ad_id}/previews` endpoint returns a single-placement iframe
   * snippet per call — we parallelize across formats so the UI can render
   * a side-by-side grid (Feed, IG Feed, Story, Reel, Right column…) in
   * one round-trip instead of N waterfalled calls.
   *
   * Per-format failures don't fail the whole batch — we surface `error`
   * on the affected cells so the user still sees the working ones.
   */
  async getAdPreviews(
    connectionId: string,
    metaAdId: string,
    formats: string[],
  ): Promise<Array<{ format: string; html: string | null; error?: string }>> {
    const { accessToken } = await getCredential(connectionId);
    return Promise.all(
      formats.map(async (format) => {
        try {
          const resp = await metaGet<{ data: Array<{ body?: string }> }>(
            `/${metaAdId}/previews`,
            accessToken,
            { ad_format: format },
          );
          const html = resp.data?.[0]?.body ?? null;
          return { format, html };
        } catch (err) {
          const message =
            err instanceof MetaApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Preview failed";
          return { format, html: null, error: message };
        }
      }),
    );
  }

  /**
   * Pull daily insights for an ad account at one level.
   * `since`/`until` are YYYY-MM-DD strings (inclusive).
   *
   * One Meta API call per level. For "account" level returns one row per day;
   * for the others returns one row per (entity, day).
   */
  async listInsights(
    connectionId: string,
    metaAdAccountId: string,
    level: NormalizedInsight["level"],
    since: string,
    until: string,
  ): Promise<NormalizedInsight[]> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;

    const fields = ["impressions", "reach", "clicks", "spend", "ctr", "cpm"];
    // At sub-account levels Meta requires the entity id field too.
    if (level === "campaign") fields.push("campaign_id");
    if (level === "adset") fields.push("adset_id");
    if (level === "ad") fields.push("ad_id");

    const params: Record<string, string> = {
      fields: fields.join(","),
      level,
      time_range: JSON.stringify({ since, until }),
      time_increment: "1", // daily breakdown
      limit: "500",
    };

    const resp = await metaGet<MetaPagedResponse<RawInsight>>(
      `/${acctId}/insights`,
      accessToken,
      params,
    );

    return resp.data.map((r) => normalizeInsight(r, level));
  }
}

interface RawCampaign {
  id: string;
  name: string;
  status: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  updated_time?: string;
}

function parseBudgetCents(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  // Meta sometimes returns "0" to mean "not set"; treat as null so the UI
  // distinguishes "no budget" from "$0 budget".
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeCampaign(raw: RawCampaign): NormalizedCampaign {
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    objective: raw.objective ?? "",
    dailyBudgetCents: parseBudgetCents(raw.daily_budget),
    lifetimeBudgetCents: parseBudgetCents(raw.lifetime_budget),
    metaUpdatedTime: raw.updated_time ? new Date(raw.updated_time) : null,
  };
}

interface RawAdSet {
  id: string;
  name: string;
  status: string;
  optimization_goal?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  updated_time?: string;
  campaign_id: string;
}

function normalizeAdSet(raw: RawAdSet): NormalizedAdSet {
  return {
    id: raw.id,
    campaignMetaId: raw.campaign_id,
    name: raw.name,
    status: raw.status,
    optimizationGoal: raw.optimization_goal ?? null,
    dailyBudgetCents: parseBudgetCents(raw.daily_budget),
    lifetimeBudgetCents: parseBudgetCents(raw.lifetime_budget),
    metaUpdatedTime: raw.updated_time ? new Date(raw.updated_time) : null,
  };
}

interface RawAd {
  id: string;
  name: string;
  status: string;
  updated_time?: string;
  adset_id: string;
}

function normalizeAd(raw: RawAd): NormalizedAd {
  return {
    id: raw.id,
    adSetMetaId: raw.adset_id,
    name: raw.name,
    status: raw.status,
    // Phase 1.1 doesn't extract creative format — left null until needed.
    format: null,
    metaUpdatedTime: raw.updated_time ? new Date(raw.updated_time) : null,
  };
}

interface RawInsight {
  date_start: string; // YYYY-MM-DD
  date_stop: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  spend?: string; // decimal in account currency, e.g. "12.50"
  ctr?: string; // percent, e.g. "0.85"
  cpm?: string; // decimal in account currency
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
}

function toInt(v: string | undefined): number {
  if (!v) return 0;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function toCents(v: string | undefined): number {
  if (!v) return 0;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function normalizeInsight(
  raw: RawInsight,
  level: NormalizedInsight["level"],
): NormalizedInsight {
  let entityId: string;
  if (level === "campaign") entityId = raw.campaign_id ?? "";
  else if (level === "adset") entityId = raw.adset_id ?? "";
  else if (level === "ad") entityId = raw.ad_id ?? "";
  else entityId = ""; // account-level — caller fills in the account id

  return {
    date: raw.date_start,
    level,
    entityId,
    impressions: toInt(raw.impressions),
    reach: toInt(raw.reach),
    clicks: toInt(raw.clicks),
    spendCents: toCents(raw.spend),
    // Meta returns ctr as a percent string ("0.85" = 0.85%). Normalize to 0..1.
    ctr: raw.ctr ? Number.parseFloat(raw.ctr) / 100 : 0,
    cpmCents: toCents(raw.cpm),
  };
}

export const metaClient = new MetaClient();
export { META_API_VERSION };
