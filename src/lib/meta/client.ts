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
  NormalizedAdAccountDetail,
  NormalizedAdCreative,
  NormalizedAdImage,
  NormalizedAdSet,
  NormalizedAdVideo,
  NormalizedCampaign,
  NormalizedCustomAudience,
  NormalizedCustomConversion,
  NormalizedDiscoveredBusiness,
  NormalizedDiscovery,
  NormalizedInsight,
  NormalizedReachEstimate,
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
   * Pull a single ad account's live financial / health fields straight from
   * Meta. Bypasses our local mirror because balance + amount_spent move every
   * minute on Meta's side — a cached value would be wrong by the time the UI
   * renders it. Caller decides what to do on failure (most pages let it fail
   * silently and hide the section).
   *
   * Meta returns money fields as strings in account-currency cents
   * ("12550" = 125.50 in the account's currency). disable_reason comes back
   * as an integer code; 0 means healthy.
   */
  async getAdAccountDetail(
    connectionId: string,
    metaAdAccountId: string,
  ): Promise<NormalizedAdAccountDetail> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;
    const raw = await metaGet<RawAdAccountDetail>(`/${acctId}`, accessToken, {
      fields:
        "balance,spend_cap,amount_spent,min_daily_budget,business_country_code,disable_reason,funding_source",
    });
    return normalizeAdAccountDetail(raw);
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

  /**
   * List ad creatives in an ad account's library.
   *
   * A creative is the design half of an ad — body text, headline, image/video,
   * link, CTA — owned at the account level so the same creative can be reused
   * across many ads. Meta returns deeply nested `object_story_spec` data; the
   * client flattens the most-displayed leaves up to top level.
   *
   * Like the other list endpoints, returns at most 200 in one page. Real-world
   * agency accounts rarely exceed this; if one does, paginate-on-demand is a
   * Phase 2+ follow-up.
   */
  async listAdCreatives(
    connectionId: string,
    metaAdAccountId: string,
  ): Promise<NormalizedAdCreative[]> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;

    const resp = await metaGet<MetaPagedResponse<RawAdCreative>>(
      `/${acctId}/adcreatives`,
      accessToken,
      {
        fields:
          "id,name,body,title,link_url,image_url,image_hash,thumbnail_url,video_id,call_to_action_type,status,effective_object_story_id,object_type,object_story_spec",
        limit: "200",
      },
    );
    return resp.data.map(normalizeAdCreative);
  }

  /**
   * Fetch one image by its hash. Counterpart to getAdVideoById — used when
   * a creative references an `image_hash` that isn't returned by
   * /act_X/adimages (Page-uploaded images, deleted-from-library images, …).
   *
   * Meta exposes single-image lookup as
   *   GET /act_{id}/adimages?hashes=["<hash>"]
   * so we pass the hash through the hashes filter rather than calling
   * /{hash} (which doesn't resolve — hashes aren't first-class entities).
   * Returns null when the image isn't accessible.
   */
  async getAdImageByHash(
    connectionId: string,
    metaAdAccountId: string,
    hash: string,
  ): Promise<NormalizedAdImage | null> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;
    try {
      const resp = await metaGet<MetaPagedResponse<RawAdImage>>(
        `/${acctId}/adimages`,
        accessToken,
        {
          fields: "hash,url,name,width,height,status,created_time",
          // Meta wants this as a JSON-encoded array of hashes.
          hashes: JSON.stringify([hash]),
        },
      );
      const first = resp.data?.[0];
      return first ? normalizeAdImage(first) : null;
    } catch (err) {
      if (err instanceof MetaApiError && err.httpStatus === 404) return null;
      throw err;
    }
  }

  /**
   * List raw images in an ad account's library.
   *
   * Different from creatives: a creative is a *composition* (image + body +
   * headline + CTA), an image is the raw pixel asset that creatives reference
   * by `image_hash`. Same image can be reused across many creatives.
   *
   * Single page, up to 200 — agency accounts rarely exceed this. Pagination
   * via `paging.next` is a Phase 2+ follow-up if needed.
   */
  async listAdImages(
    connectionId: string,
    metaAdAccountId: string,
  ): Promise<NormalizedAdImage[]> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;
    const resp = await metaGet<MetaPagedResponse<RawAdImage>>(
      `/${acctId}/adimages`,
      accessToken,
      {
        fields: "hash,url,name,width,height,status,created_time",
        limit: "200",
      },
    );
    return resp.data.map(normalizeAdImage);
  }

  /**
   * Fetch one video by its id. Use this when a creative references a
   * `video_id` that isn't in /act_X/advideos — Meta's video library
   * endpoint only returns videos uploaded directly to the ad account, so
   * Page-uploaded videos used in ads need to be fetched individually.
   *
   * Returns null on 404 / not-accessible — the caller decides whether to
   * surface that as a soft warning or skip the row entirely.
   */
  async getAdVideoById(
    connectionId: string,
    metaVideoId: string,
  ): Promise<NormalizedAdVideo | null> {
    const { accessToken } = await getCredential(connectionId);
    try {
      const raw = await metaGet<RawAdVideo>(`/${metaVideoId}`, accessToken, {
        fields:
          "id,title,description,picture,source,length,status,created_time",
      });
      return normalizeAdVideo(raw);
    } catch (err) {
      if (err instanceof MetaApiError && err.httpStatus === 404) return null;
      throw err;
    }
  }

  /**
   * List raw videos in an ad account's library — counterpart to listAdImages
   * for video assets. A creative references the underlying video by
   * `video_id`, and the same video can back many creatives.
   *
   * Single page, up to 200. Pagination is a Phase 2+ follow-up if any
   * account ever exceeds this. NOTE: this endpoint only returns videos
   * uploaded into the ad account's library directly. Videos uploaded as
   * Facebook Page posts and then used in ads do NOT appear here — use
   * `getAdVideoById` to fetch those individually by their video_id.
   */
  async listAdVideos(
    connectionId: string,
    metaAdAccountId: string,
  ): Promise<NormalizedAdVideo[]> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;
    const resp = await metaGet<MetaPagedResponse<RawAdVideo>>(
      `/${acctId}/advideos`,
      accessToken,
      {
        fields:
          "id,title,description,picture,source,length,status,created_time",
        limit: "200",
      },
    );
    return resp.data.map(normalizeAdVideo);
  }

  /**
   * Ask Meta to estimate how many people a given targeting spec would
   * reach. Fires interactively from the Create Ad Set modal as the user
   * tweaks targeting — no DB, no sync, just a live pass-through.
   *
   * Targeting goes JSON-stringified per Meta convention. Optimization goal
   * narrows the curve to the goal the ad set will actually optimize for
   * (different goals yield very different audiences for the same spec).
   *
   * Returns 0/0/not-ready on the rare case Meta returns no `data` row
   * (brand-new accounts, exotic targeting it can't compute on).
   */
  async getDeliveryEstimate(
    connectionId: string,
    metaAdAccountId: string,
    targetingSpec: Record<string, unknown>,
    optimizationGoal: string,
  ): Promise<NormalizedReachEstimate> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;
    const resp = await metaGet<{
      data?: Array<{
        estimate_mau_lower_bound?: number;
        estimate_mau_upper_bound?: number;
        estimate_ready?: boolean;
      }>;
    }>(`/${acctId}/delivery_estimate`, accessToken, {
      targeting_spec: JSON.stringify(targetingSpec),
      optimization_goal: optimizationGoal,
    });
    const row = resp.data?.[0];
    return {
      lowerBound: row?.estimate_mau_lower_bound ?? 0,
      upperBound: row?.estimate_mau_upper_bound ?? 0,
      ready: row?.estimate_ready ?? false,
    };
  }

  /**
   * List custom conversions saved on an ad account. These are rules layered
   * on top of Pixel events (e.g. "Purchase with value > $100", "URL contains
   * /thank-you") used as the optimization target for conversion-objective
   * ad sets via `promoted_object.custom_conversion_id`.
   *
   * Single page, up to 200. `rule` arrives as either a JSON string or a
   * nested object depending on Meta's response build — we coerce both to a
   * string for storage so the UI can render it verbatim.
   */
  async listCustomConversions(
    connectionId: string,
    metaAdAccountId: string,
  ): Promise<NormalizedCustomConversion[]> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;
    const resp = await metaGet<MetaPagedResponse<RawCustomConversion>>(
      `/${acctId}/customconversions`,
      accessToken,
      {
        fields:
          "id,name,description,rule,custom_event_type,event_source_id,last_fired_time,creation_time",
        limit: "200",
      },
    );
    return resp.data.map(normalizeCustomConversion);
  }

  /**
   * List custom audiences saved on an ad account. These are targeting
   * shortcuts (CRM uploads, pixel visitors, lookalikes, …) the agency built
   * in Ads Manager; we mirror them so the Create Ad Set form can show a
   * picker instead of asking users to type Meta ids by hand.
   *
   * Single page up to 200. Meta's `approximate_count` comes back as an
   * integer for large audiences and as a string sentinel ("<1000") for
   * tiny / bucketed ones — the normalizer collapses sentinels to null.
   */
  async listCustomAudiences(
    connectionId: string,
    metaAdAccountId: string,
  ): Promise<NormalizedCustomAudience[]> {
    const { accessToken } = await getCredential(connectionId);
    const acctId = metaAdAccountId.startsWith("act_")
      ? metaAdAccountId
      : `act_${metaAdAccountId}`;
    const resp = await metaGet<MetaPagedResponse<RawCustomAudience>>(
      `/${acctId}/customaudiences`,
      accessToken,
      {
        fields:
          "id,name,subtype,description,approximate_count,operation_status,data_source,time_created",
        limit: "200",
      },
    );
    return resp.data.map(normalizeCustomAudience);
  }

  /**
   * List ads for an ad account. Each row carries its parent ad set id AND
   * the creative it's using — Meta supports the `creative{id,thumbnail_url}`
   * field expansion on this endpoint, so we get a thumbnail per ad without
   * making N extra calls.
   */
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
        fields:
          "id,name,status,updated_time,adset_id,creative{id,thumbnail_url}",
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

interface RawCustomConversion {
  id: string;
  name: string;
  description?: string;
  // Meta returns this as JSON-string OR pre-parsed object depending on the
  // SDK build. We coerce both shapes to a string for storage.
  rule?: string | object;
  custom_event_type?: string;
  event_source_id?: string;
  last_fired_time?: string;
  creation_time?: string;
}

function normalizeCustomConversion(
  raw: RawCustomConversion,
): NormalizedCustomConversion {
  let rule: string | null = null;
  if (typeof raw.rule === "string") {
    rule = raw.rule;
  } else if (raw.rule && typeof raw.rule === "object") {
    rule = JSON.stringify(raw.rule);
  }
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? null,
    rule,
    customEventType: raw.custom_event_type ?? null,
    eventSourceId: raw.event_source_id ?? null,
    lastFiredTime: raw.last_fired_time ? new Date(raw.last_fired_time) : null,
    createdTime: raw.creation_time ? new Date(raw.creation_time) : null,
  };
}

interface RawCustomAudience {
  id: string;
  name: string;
  subtype?: string;
  description?: string;
  // Integer for large audiences; string sentinel like "<1000" for tiny ones.
  approximate_count?: number | string;
  operation_status?: { code?: number; description?: string } | string;
  // Newer responses nest data source under an object; older returned a flat
  // string. Accept either; the UI only cares about `sub_type` if nested.
  data_source?: { sub_type?: string; type?: string } | string;
  time_created?: number | string;
}

function normalizeCustomAudience(
  raw: RawCustomAudience,
): NormalizedCustomAudience {
  // approximate_count: only keep when it's an integer; sentinels (e.g.
  // "<1000") collapse to null so the UI can render "Less than 1000".
  let approximateCount: number | null = null;
  if (typeof raw.approximate_count === "number") {
    approximateCount = raw.approximate_count;
  } else if (typeof raw.approximate_count === "string") {
    const n = Number.parseInt(raw.approximate_count, 10);
    approximateCount = Number.isFinite(n) ? n : null;
  }

  // operation_status: prefer the human-readable `description` field when
  // Meta nests it under an object; fall back to the string form for older
  // responses. We never store the numeric code — UI shouldn't depend on it.
  let operationStatus: string | null = null;
  if (typeof raw.operation_status === "string") {
    operationStatus = raw.operation_status;
  } else if (raw.operation_status && typeof raw.operation_status === "object") {
    operationStatus = raw.operation_status.description ?? null;
  }

  let dataSourceSubtype: string | null = null;
  if (typeof raw.data_source === "string") {
    dataSourceSubtype = raw.data_source;
  } else if (raw.data_source && typeof raw.data_source === "object") {
    dataSourceSubtype = raw.data_source.sub_type ?? raw.data_source.type ?? null;
  }

  // time_created: Meta returns unix seconds as a number OR an ISO string,
  // depending on the response. Try both.
  let createdTime: Date | null = null;
  if (typeof raw.time_created === "number") {
    createdTime = new Date(raw.time_created * 1000);
  } else if (typeof raw.time_created === "string") {
    const parsed = new Date(raw.time_created);
    if (!Number.isNaN(parsed.getTime())) createdTime = parsed;
  }

  return {
    id: raw.id,
    name: raw.name,
    subtype: raw.subtype ?? null,
    description: raw.description ?? null,
    approximateCount,
    operationStatus,
    dataSourceSubtype,
    createdTime,
  };
}

interface RawAdVideo {
  id: string;
  title?: string;
  description?: string;
  picture?: string;
  source?: string;
  // Meta returns length in seconds as a number, occasionally a numeric string
  // for older videos — accept both and coerce.
  length?: number | string;
  // Newer Meta responses nest video status under an object. Older ones
  // returned a top-level string. Accept either shape.
  status?: string | { video_status?: string };
  created_time?: string;
}

function normalizeAdVideo(raw: RawAdVideo): NormalizedAdVideo {
  let lengthSeconds: number | null = null;
  if (typeof raw.length === "number") {
    lengthSeconds = raw.length;
  } else if (typeof raw.length === "string") {
    const n = Number.parseFloat(raw.length);
    lengthSeconds = Number.isFinite(n) ? n : null;
  }

  let status: string | null = null;
  if (typeof raw.status === "string") {
    status = raw.status;
  } else if (raw.status && typeof raw.status === "object") {
    status = raw.status.video_status ?? null;
  }

  return {
    id: raw.id,
    title: raw.title ?? null,
    description: raw.description ?? null,
    thumbnailUrl: raw.picture ?? null,
    sourceUrl: raw.source ?? null,
    lengthSeconds,
    status,
    createdTime: raw.created_time ? new Date(raw.created_time) : null,
  };
}

interface RawAdImage {
  hash: string;
  url?: string;
  name?: string;
  width?: number;
  height?: number;
  status?: string;
  created_time?: string;
}

function normalizeAdImage(raw: RawAdImage): NormalizedAdImage {
  return {
    hash: raw.hash,
    url: raw.url ?? null,
    name: raw.name ?? null,
    width: typeof raw.width === "number" ? raw.width : null,
    height: typeof raw.height === "number" ? raw.height : null,
    status: raw.status ?? null,
    createdTime: raw.created_time ? new Date(raw.created_time) : null,
  };
}

interface RawAdCreativeCTA {
  type?: string;
}

interface RawAdCreativeLinkData {
  link?: string;
  message?: string;
  name?: string;
  image_hash?: string;
  call_to_action?: RawAdCreativeCTA;
}

interface RawAdCreativeObjectStorySpec {
  page_id?: string;
  instagram_actor_id?: string;
  link_data?: RawAdCreativeLinkData;
}

interface RawAdCreative {
  id: string;
  name?: string;
  body?: string;
  title?: string;
  link_url?: string;
  image_url?: string;
  image_hash?: string;
  thumbnail_url?: string;
  video_id?: string;
  call_to_action_type?: string;
  status?: string;
  effective_object_story_id?: string;
  object_type?: string;
  object_story_spec?: RawAdCreativeObjectStorySpec;
}

function normalizeAdCreative(raw: RawAdCreative): NormalizedAdCreative {
  // Meta puts body/headline/link at top level for some ad formats and nests
  // them under object_story_spec.link_data for others (Page-promoted ads).
  // Prefer top-level when present, fall back to the nested shape.
  const linkData = raw.object_story_spec?.link_data;
  const body = raw.body ?? linkData?.message ?? null;
  const title = raw.title ?? linkData?.name ?? null;
  const linkUrl = raw.link_url ?? linkData?.link ?? null;
  const imageHash = raw.image_hash ?? linkData?.image_hash ?? null;
  const callToActionType =
    raw.call_to_action_type ?? linkData?.call_to_action?.type ?? null;

  return {
    id: raw.id,
    name: raw.name ?? null,
    body,
    title,
    linkUrl,
    imageUrl: raw.image_url ?? null,
    imageHash,
    thumbnailUrl: raw.thumbnail_url ?? null,
    videoId: raw.video_id ?? null,
    callToActionType,
    status: raw.status ?? null,
    effectiveStoryId: raw.effective_object_story_id ?? null,
    pageId: raw.object_story_spec?.page_id ?? null,
    instagramActorId: raw.object_story_spec?.instagram_actor_id ?? null,
    objectType: raw.object_type ?? null,
  };
}

interface RawAdAccountDetail {
  balance?: string;             // outstanding owed, cents as string
  spend_cap?: string;           // "0" means no cap configured
  amount_spent?: string;        // lifetime/cycle spend, cents as string
  min_daily_budget?: number;    // cents, integer
  business_country_code?: string;
  // Meta returns this as a numeric code; 0 = healthy.
  disable_reason?: number;
  // Long FBID of the funding source. Resolving to a human label needs a
  // second call we don't make yet.
  funding_source?: string;
}

// Stable string codes the UI maps to labels + remediation hints. Source of
// truth: https://developers.facebook.com/docs/marketing-api/reference/ad-account/
function decodeDisableReason(code: number | undefined): string | null {
  if (!code || code === 0) return null;
  switch (code) {
    case 1: return "ADS_INTEGRITY_POLICY";
    case 2: return "ADS_IP_REVIEW";
    case 3: return "RISK_PAYMENT";
    case 4: return "GRAY_ACCOUNT_SHUT_DOWN";
    case 5: return "ADS_AFC_REVIEW";
    case 6: return "BUSINESS_INTEGRITY_RAR";
    case 7: return "PERMANENT_CLOSE";
    case 8: return "UNUSED_RESELLER_ACCOUNT";
    case 9: return "UNUSED_ACCOUNT";
    default: return `UNKNOWN_${code}`;
  }
}

function parseCentsString(v: string | undefined): number {
  if (!v) return 0;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function normalizeAdAccountDetail(
  raw: RawAdAccountDetail,
): NormalizedAdAccountDetail {
  // Meta uses "0" for spend_cap to mean "no cap" — surface as null so the UI
  // can distinguish "no cap" from "₹0 cap" (which would be nonsensical).
  const capRaw = parseCentsString(raw.spend_cap);
  return {
    balanceCents: parseCentsString(raw.balance),
    spendCapCents: capRaw > 0 ? capRaw : null,
    amountSpentCents: parseCentsString(raw.amount_spent),
    minDailyBudgetCents:
      typeof raw.min_daily_budget === "number" && raw.min_daily_budget > 0
        ? raw.min_daily_budget
        : null,
    fundingSourceId: raw.funding_source ?? null,
    businessCountryCode: raw.business_country_code ?? null,
    disableReason: decodeDisableReason(raw.disable_reason),
  };
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
  // From the `creative{id,thumbnail_url}` field expansion. Nested object —
  // not all ads have a creative attached (rare but happens during drafts),
  // so the field can be absent.
  creative?: {
    id?: string;
    thumbnail_url?: string;
  };
}

function normalizeAd(raw: RawAd): NormalizedAd {
  return {
    id: raw.id,
    adSetMetaId: raw.adset_id,
    name: raw.name,
    status: raw.status,
    // Phase 1.1 doesn't extract creative format — left null until needed.
    format: null,
    creativeId: raw.creative?.id ?? null,
    creativeThumbnailUrl: raw.creative?.thumbnail_url ?? null,
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
