/**
 * Auto-account audit — one-click portfolio housekeeping for the agency.
 *
 * Composes a handful of independent "checks" that each return AuditFindings,
 * then asks the LLM for a 2–3 sentence executive summary on top. The checks
 * are intentionally lightweight: each is a small SQL query (sometimes plus a
 * single LLM call) so the whole audit completes in a few seconds per account.
 *
 * Checks today:
 *   • budget_misallocation — top over-funded losers + under-funded winners
 *     across active ad sets, ranked by the (spend × ROAS) gap to the median.
 *   • naming_inconsistency — LLM scans campaign / ad-set names for date
 *     format drift, naming pattern breaks, typos, missing prefixes.
 *   • url_utm — parses creative landing URLs, flags missing / inconsistent
 *     utm_* parameters across the account.
 *   • voice_drift — uses the existing ad-copy embeddings to find creatives
 *     whose embedding is far from the account's voice centroid (the
 *     average of the top-N performers).
 *
 * Each finding stamps a severity (high / medium / low / info) so the UI
 * can rank what matters. No data is persisted — the audit is cheap enough
 * to re-run any time, and the strategist usually wants the latest view
 * anyway.
 */

import OpenAI from "openai";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { complete } from "@/lib/llm/chat";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "missing-key" });

const AUDIT_WINDOW_DAYS = 30;

export interface AuditFinding {
  kind:
    | "budget_misallocation"
    | "naming_inconsistency"
    | "url_utm"
    | "voice_drift";
  severity: "high" | "medium" | "low" | "info";
  title: string;
  body: string;
  // Optional entity reference + deep-link so the UI can click straight to
  // where the user can fix the issue (skip the "now go find this campaign
  // manually" step).
  entity?: {
    type: "campaign" | "adset" | "ad" | "creative";
    id: string;
    name: string;
    navUrl?: string;
  };
  metrics?: Record<string, unknown>;
}

export interface AuditResult {
  /** Persisted Audit row id — used to refer back to this exact run later. */
  id: string;
  metaAdAccountId: string;
  accountName: string;
  businessName: string;
  generatedAt: string;
  windowDays: number;
  findings: AuditFinding[];
  summary: string; // LLM-narrated overall takeaway
  stats: {
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

function safeDiv(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

function severityRank(s: AuditFinding["severity"]): number {
  return s === "high" ? 0 : s === "medium" ? 1 : s === "low" ? 2 : 3;
}

// ── Public entry point ──────────────────────────────────────────────────

export async function auditAccount(
  metaAdAccountIdParam: string,
): Promise<AuditResult> {
  const metaAdAccountId = metaAdAccountIdParam.startsWith("act_")
    ? metaAdAccountIdParam
    : `act_${metaAdAccountIdParam}`;

  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId, selectedForSync: true },
    include: { business: { select: { name: true } } },
  });
  if (!account) {
    throw new Error("Ad account not found or not selected for sync");
  }

  // Run the four checks in parallel. Each catches its own errors and
  // returns [] so one failing check doesn't kill the whole audit.
  const [budget, naming, urls, voice] = await Promise.all([
    checkBudgetAllocation(account.id, account.currency).catch((err) => {
      console.error("audit budget check failed:", err);
      return [] as AuditFinding[];
    }),
    checkNamingConsistency(account.id).catch((err) => {
      console.error("audit naming check failed:", err);
      return [] as AuditFinding[];
    }),
    checkUrlsAndUtms(account.id).catch((err) => {
      console.error("audit URL/UTM check failed:", err);
      return [] as AuditFinding[];
    }),
    checkVoiceDrift(account.id).catch((err) => {
      console.error("audit voice drift check failed:", err);
      return [] as AuditFinding[];
    }),
  ]);

  const raw = [...budget, ...naming, ...urls, ...voice].sort((a, b) => {
    return severityRank(a.severity) - severityRank(b.severity);
  });

  // Enrich every finding with a deep-link to where the strategist can fix
  // it. Done after collection so each check stays focused on detection.
  const accountUrlId = account.metaAdAccountId.replace(/^act_/, "");
  const findings = await Promise.all(
    raw.map(async (f) => {
      if (!f.entity) return f;
      const navUrl = await resolveNavUrl({
        accountUrlId,
        adAccountLocalId: account.id,
        entityType: f.entity.type,
        entityMetaId: f.entity.id,
      });
      return {
        ...f,
        entity: { ...f.entity, navUrl },
      };
    }),
  );

  const stats = {
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
    info: findings.filter((f) => f.severity === "info").length,
  };

  const summary = await generateAuditSummary({
    accountName: account.name,
    businessName: account.business.name,
    findings,
  });

  // Persist for later reference — the audit page loads the latest by
  // default so the strategist can come back without paying for a re-run.
  const persisted = await prisma.audit.create({
    data: {
      adAccountId: account.id,
      windowDays: AUDIT_WINDOW_DAYS,
      summary,
      findings: findings as unknown as Prisma.InputJsonValue,
      stats: stats as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, runAt: true },
  });

  return {
    id: persisted.id,
    metaAdAccountId: account.metaAdAccountId,
    accountName: account.name,
    businessName: account.business.name,
    generatedAt: persisted.runAt.toISOString(),
    windowDays: AUDIT_WINDOW_DAYS,
    findings,
    summary,
    stats,
  };
}

// ── Persisted-audit fetch helpers ──────────────────────────────────────

/**
 * Read the most recent persisted audit for an account. Returns null when
 * no audit has ever been run — the page falls back to the empty state.
 */
export async function getLatestAuditForAccount(
  metaAdAccountIdParam: string,
): Promise<AuditResult | null> {
  const metaAdAccountId = metaAdAccountIdParam.startsWith("act_")
    ? metaAdAccountIdParam
    : `act_${metaAdAccountIdParam}`;

  const account = await prisma.metaAdAccount.findFirst({
    where: { metaAdAccountId, selectedForSync: true },
    include: { business: { select: { name: true } } },
  });
  if (!account) return null;

  const row = await prisma.audit.findFirst({
    where: { adAccountId: account.id },
    orderBy: { runAt: "desc" },
  });
  if (!row) return null;

  return {
    id: row.id,
    metaAdAccountId: account.metaAdAccountId,
    accountName: account.name,
    businessName: account.business.name,
    generatedAt: row.runAt.toISOString(),
    windowDays: row.windowDays,
    findings: (row.findings as unknown as AuditFinding[]) ?? [],
    summary: row.summary,
    stats: (row.stats as unknown as AuditResult["stats"]) ?? {
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    },
  };
}

// ── Deep-link resolver ─────────────────────────────────────────────────
//
// Turns a finding's (entityType, entityId) into a relative URL the UI can
// link to. Walks the parent chain via Prisma so click-through lands on the
// page where the strategist can actually fix the issue:
//   • campaign  → /dashboard/accounts/[id]/campaigns/[campaignId]/adsets
//   • adset     → …/adsets/[adsetId]/ads
//   • ad        → …/ads/[adId]   (the ad detail page where Edit lives)
//   • creative  → its parent ad's detail page (closest place to act)

async function resolveNavUrl(args: {
  accountUrlId: string;
  adAccountLocalId: string;
  entityType: "campaign" | "adset" | "ad" | "creative";
  entityMetaId: string;
}): Promise<string | undefined> {
  const { accountUrlId, adAccountLocalId, entityType, entityMetaId } = args;

  if (entityType === "campaign") {
    // Verify it exists locally — a stale LLM hallucinated id would give a
    // 404 link otherwise.
    const exists = await prisma.campaign.findFirst({
      where: {
        adAccountId: adAccountLocalId,
        metaCampaignId: entityMetaId,
      },
      select: { metaCampaignId: true },
    });
    if (!exists) return undefined;
    return `/dashboard/accounts/${accountUrlId}/campaigns/${entityMetaId}/adsets`;
  }

  if (entityType === "adset") {
    const adSet = await prisma.adSet.findFirst({
      where: { metaAdSetId: entityMetaId, adAccountId: adAccountLocalId },
      include: { campaign: { select: { metaCampaignId: true } } },
    });
    if (!adSet) return undefined;
    return `/dashboard/accounts/${accountUrlId}/campaigns/${adSet.campaign.metaCampaignId}/adsets/${entityMetaId}/ads`;
  }

  if (entityType === "ad") {
    const ad = await prisma.ad.findFirst({
      where: { metaAdId: entityMetaId, adAccountId: adAccountLocalId },
      include: {
        adSet: {
          include: { campaign: { select: { metaCampaignId: true } } },
        },
      },
    });
    if (!ad) return undefined;
    return `/dashboard/accounts/${accountUrlId}/campaigns/${ad.adSet.campaign.metaCampaignId}/adsets/${ad.adSet.metaAdSetId}/ads/${entityMetaId}`;
  }

  if (entityType === "creative") {
    // Walk through any ad that uses this creative — that ad's detail page
    // is the closest "Edit / Replace creative" surface.
    const ad = await prisma.ad.findFirst({
      where: {
        metaCreativeId: entityMetaId,
        adAccountId: adAccountLocalId,
      },
      include: {
        adSet: {
          include: { campaign: { select: { metaCampaignId: true } } },
        },
      },
    });
    if (ad) {
      return `/dashboard/accounts/${accountUrlId}/campaigns/${ad.adSet.campaign.metaCampaignId}/adsets/${ad.adSet.metaAdSetId}/ads/${ad.metaAdId}`;
    }
    // Fallback: the creatives library page (account-scoped via client filter).
    return `/dashboard/creatives`;
  }

  return undefined;
}

// ── Check 1: budget allocation ─────────────────────────────────────────
//
// For each active ad set with meaningful delivery in the window, compute
// spend + ROAS. Flag:
//   • over-funded losers — high spend, low ROAS vs median
//   • under-funded winners — low spend, high ROAS vs median
// Pure data — no LLM call needed.

const SPEND_FLOOR_CENTS = 200 * 100; // ad-set baseline

async function checkBudgetAllocation(
  adAccountLocalId: string,
  currency: string,
): Promise<AuditFinding[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - AUDIT_WINDOW_DAYS);

  // Active ad sets only — paused ones are intentionally idle.
  const adSets = await prisma.adSet.findMany({
    where: { adAccountId: adAccountLocalId, status: "ACTIVE" },
    select: { metaAdSetId: true, name: true, campaignId: true },
  });
  if (adSets.length === 0) return [];

  const insights = await prisma.insightsSnapshot.findMany({
    where: {
      adAccountId: adAccountLocalId,
      level: "adset",
      entityId: { in: adSets.map((a) => a.metaAdSetId) },
      date: { gte: since },
    },
    select: {
      entityId: true,
      spendCents: true,
      revenueCents: true,
      conversionsCount: true,
    },
  });

  interface AdSetPerf {
    metaAdSetId: string;
    name: string;
    spendCents: number;
    revenueCents: number;
    conversionsCount: number;
    roas: number;
  }
  const byId = new Map<string, AdSetPerf>();
  for (const a of adSets) {
    byId.set(a.metaAdSetId, {
      metaAdSetId: a.metaAdSetId,
      name: a.name,
      spendCents: 0,
      revenueCents: 0,
      conversionsCount: 0,
      roas: 0,
    });
  }
  for (const r of insights) {
    const cur = byId.get(r.entityId);
    if (!cur) continue;
    cur.spendCents += r.spendCents;
    cur.revenueCents += r.revenueCents;
    cur.conversionsCount += r.conversionsCount;
  }
  for (const v of byId.values()) {
    v.roas = safeDiv(v.revenueCents, v.spendCents);
  }

  const rows = Array.from(byId.values()).filter(
    (v) => v.spendCents >= SPEND_FLOOR_CENTS,
  );
  if (rows.length < 3) return [];

  // Median spend + median ROAS — robust to outliers vs mean.
  const median = (arr: number[]): number => {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  };
  const medSpend = median(rows.map((r) => r.spendCents));
  const withRoas = rows.filter((r) => r.roas > 0);
  if (withRoas.length < 3) {
    // Without ROAS we can still flag using conversions; for now bail.
    return [];
  }
  const medRoas = median(withRoas.map((r) => r.roas));

  const overFundedLosers = rows
    .filter((r) => r.spendCents > medSpend && r.roas > 0 && r.roas < medRoas)
    .sort((a, b) => b.spendCents - a.spendCents)
    .slice(0, 3);
  const underFundedWinners = rows
    .filter((r) => r.spendCents < medSpend && r.roas > medRoas)
    .sort((a, b) => b.roas - a.roas)
    .slice(0, 3);

  const findings: AuditFinding[] = [];
  const fmt = (cents: number) =>
    (cents / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });

  for (const a of overFundedLosers) {
    findings.push({
      kind: "budget_misallocation",
      severity: a.roas < 0.5 ? "high" : "medium",
      title: `Over-funded ad set: ${a.name}`,
      body: `Spent ${fmt(a.spendCents)} ${currency} in the last ${AUDIT_WINDOW_DAYS} days (above median ${fmt(medSpend)}) but ROAS is ${a.roas.toFixed(2)}× — below the account median of ${medRoas.toFixed(2)}×. Consider trimming budget or pausing.`,
      entity: { type: "adset", id: a.metaAdSetId, name: a.name },
      metrics: {
        spendCents: a.spendCents,
        roas: a.roas,
        medianSpend: medSpend,
        medianRoas: medRoas,
      },
    });
  }
  for (const a of underFundedWinners) {
    findings.push({
      kind: "budget_misallocation",
      severity: "medium",
      title: `Under-funded winner: ${a.name}`,
      body: `Only spent ${fmt(a.spendCents)} ${currency} in the last ${AUDIT_WINDOW_DAYS} days (below median ${fmt(medSpend)}) but ROAS is ${a.roas.toFixed(2)}× — above the account median of ${medRoas.toFixed(2)}×. Likely worth scaling.`,
      entity: { type: "adset", id: a.metaAdSetId, name: a.name },
      metrics: {
        spendCents: a.spendCents,
        roas: a.roas,
        medianSpend: medSpend,
        medianRoas: medRoas,
      },
    });
  }
  return findings;
}

// ── Check 2: naming consistency ────────────────────────────────────────
//
// LLM scans campaign + ad-set names for date-format drift, naming pattern
// breaks, typos, missing prefixes. Single batched call — cheap.

interface NamingIssue {
  entityType: "campaign" | "adset";
  entityId: string;
  entityName: string;
  issue: string;
  severity: "high" | "medium" | "low";
}
interface NamingIssuesPayload {
  issues: NamingIssue[];
}

async function checkNamingConsistency(
  adAccountLocalId: string,
): Promise<AuditFinding[]> {
  const [campaigns, adSets] = await Promise.all([
    prisma.campaign.findMany({
      where: { adAccountId: adAccountLocalId },
      select: { metaCampaignId: true, name: true },
      take: 100,
    }),
    prisma.adSet.findMany({
      where: { adAccountId: adAccountLocalId },
      select: { metaAdSetId: true, name: true },
      take: 200,
    }),
  ]);

  if (campaigns.length < 3 && adSets.length < 3) return [];

  const block =
    `CAMPAIGNS:\n${campaigns.map((c) => `  • [${c.metaCampaignId}] ${c.name}`).join("\n")}\n\n` +
    `AD SETS:\n${adSets.map((a) => `  • [${a.metaAdSetId}] ${a.name}`).join("\n")}`;

  const SCHEMA = {
    name: "naming_issues",
    schema: {
      type: "object",
      properties: {
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              entityType: { type: "string", enum: ["campaign", "adset"] },
              entityId: { type: "string" },
              entityName: { type: "string" },
              issue: { type: "string" },
              severity: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["entityType", "entityId", "entityName", "issue", "severity"],
            additionalProperties: false,
          },
        },
      },
      required: ["issues"],
      additionalProperties: false,
    },
  };

  const system = `You are a senior media-buyer doing a quick naming-convention audit. Look at the list of campaign and ad-set names below and flag entities whose names break the account's apparent convention.

Flag things like:
- Date-format drift (some "21/01/26", some "Jan 21 2026", some no date)
- Naming-pattern breaks (some follow "Channel-Objective-Audience-Creative-Date", others don't)
- Likely typos
- Missing client / agency prefix when most others have it
- Ambiguous or test-y names ("test", "abc", "untitled") still active

Rules:
- ONLY flag genuine inconsistencies — if names look intentional or follow no convention, return an empty array.
- Severity: "high" = blocks campaign management; "medium" = makes reporting hard; "low" = mild cleanup.
- Use the entityId exactly as given so the UI can link back.
- Keep "issue" to ONE short sentence.
- Cap output at 10 most important issues.`;

  const userPrompt = `Account inventory follows. Identify naming issues:\n\n${block}`;

  // gpt-4o-mini is plenty for structured naming-pattern detection — the
  // task is conventional rule-spotting against a list, not deep reasoning.
  // Drops this call's cost ~15× vs gpt-4o.
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: SCHEMA.name,
        schema: SCHEMA.schema,
        strict: true,
      },
    },
    temperature: 0.3,
    max_completion_tokens: 1200,
  });

  const content = res.choices[0]?.message?.content ?? '{"issues":[]}';
  const parsed = JSON.parse(content) as NamingIssuesPayload;

  return (parsed.issues ?? []).slice(0, 10).map(
    (i): AuditFinding => ({
      kind: "naming_inconsistency",
      severity: i.severity,
      title: `Naming: ${i.entityName}`,
      body: i.issue,
      entity: {
        type: i.entityType,
        id: i.entityId,
        name: i.entityName,
      },
    }),
  );
}

// ── Check 3: URL / UTM consistency ─────────────────────────────────────
//
// Pull all creative landing URLs, parse query strings. Flag:
//   • creatives with NO UTMs while others have them (tracking blind spot)
//   • inconsistent utm_source / utm_medium values across creatives that
//     ought to be uniform
// Pure data — no LLM needed.

async function checkUrlsAndUtms(
  adAccountLocalId: string,
): Promise<AuditFinding[]> {
  const creatives = await prisma.adCreative.findMany({
    where: {
      adAccountId: adAccountLocalId,
      linkUrl: { not: null },
    },
    select: { metaCreativeId: true, name: true, linkUrl: true },
    take: 500,
  });
  if (creatives.length < 3) return [];

  interface Parsed {
    metaCreativeId: string;
    name: string | null;
    url: string;
    hasUtm: boolean;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
  }
  const parsed: Parsed[] = [];
  for (const c of creatives) {
    if (!c.linkUrl) continue;
    try {
      const u = new URL(c.linkUrl);
      parsed.push({
        metaCreativeId: c.metaCreativeId,
        name: c.name,
        url: c.linkUrl,
        hasUtm: u.searchParams.has("utm_source"),
        utmSource: u.searchParams.get("utm_source"),
        utmMedium: u.searchParams.get("utm_medium"),
        utmCampaign: u.searchParams.get("utm_campaign"),
      });
    } catch {
      // Bad URL — surface as its own finding
      parsed.push({
        metaCreativeId: c.metaCreativeId,
        name: c.name,
        url: c.linkUrl,
        hasUtm: false,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
      });
    }
  }

  const findings: AuditFinding[] = [];
  const withUtm = parsed.filter((p) => p.hasUtm).length;
  const withoutUtm = parsed.filter((p) => !p.hasUtm).length;

  // If most have UTMs but some don't → tracking blind spot
  if (withUtm >= 3 && withoutUtm > 0 && withUtm > withoutUtm) {
    const culprits = parsed.filter((p) => !p.hasUtm).slice(0, 5);
    findings.push({
      kind: "url_utm",
      severity: "high",
      title: `${withoutUtm} creative${withoutUtm === 1 ? "" : "s"} missing UTM tracking`,
      body: `Most of this account's creatives (${withUtm}) tag their landing URLs with utm_source — but ${withoutUtm} don't. Those clicks won't show up in GA / your funnel analytics. Examples: ${culprits.map((c) => c.name ?? c.metaCreativeId).join(", ")}.`,
      metrics: {
        withUtm,
        withoutUtm,
        sampleIds: culprits.map((c) => c.metaCreativeId),
      },
    });
  }

  // Inconsistent utm_source across creatives that have UTMs
  const sources = new Set(
    parsed
      .filter((p) => p.hasUtm && p.utmSource)
      .map((p) => p.utmSource!.toLowerCase()),
  );
  if (sources.size > 3) {
    findings.push({
      kind: "url_utm",
      severity: "medium",
      title: `${sources.size} different utm_source values in use`,
      body: `Inconsistent utm_source values (${Array.from(sources).slice(0, 6).join(", ")}…) make ad-spend attribution messy in GA. Pick one canonical value (typically "facebook" or "meta") and standardise.`,
      metrics: { distinctSources: Array.from(sources) },
    });
  }

  return findings;
}

// ── Check 4: voice drift ───────────────────────────────────────────────
//
// Uses the existing ad-copy embeddings. Compute a "voice centroid" from
// the account's top-performing creatives, then flag creatives whose
// embedding is far from that centroid. The far ones are the brand-voice
// outliers.

async function checkVoiceDrift(
  adAccountLocalId: string,
): Promise<AuditFinding[]> {
  // Pull embeddings for this account. We bypass Prisma for the vector
  // column — same pattern the RAG service uses.
  interface Row {
    id: string;
    sourceId: string;
    content: string;
    metadata: Record<string, unknown>;
    // Raw vector returned as a string like "[0.1,0.2,...]"; we parse below.
    vec: string;
  }
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id, "sourceId", content, metadata, "vector"::text AS vec
    FROM "Embedding"
    WHERE namespace = 'ads' AND "adAccountId" = ${adAccountLocalId}
  `;
  if (rows.length < 5) return [];

  function parseVec(s: string): number[] {
    return s
      .slice(1, -1)
      .split(",")
      .map((x) => Number(x));
  }

  const vectors = rows.map((r) => ({
    ...r,
    v: parseVec(r.vec),
    spendCents: Number((r.metadata ?? {}).spendCents ?? 0),
  }));

  // Voice centroid = average of top-N performers by spend (proxy for
  // "the brand voice that actually ran the most"). If no perf, use all.
  const performers = vectors.filter((v) => v.spendCents > 0);
  const anchorSet = performers.length >= 5 ? performers : vectors;
  const top = [...anchorSet]
    .sort((a, b) => b.spendCents - a.spendCents)
    .slice(0, Math.min(10, anchorSet.length));

  const dim = top[0].v.length;
  const centroid = new Array<number>(dim).fill(0);
  for (const t of top) {
    for (let i = 0; i < dim; i++) centroid[i] += t.v[i];
  }
  for (let i = 0; i < dim; i++) centroid[i] /= top.length;

  // Cosine distance from centroid.
  function magnitude(v: number[]): number {
    let s = 0;
    for (const x of v) s += x * x;
    return Math.sqrt(s);
  }
  const cMag = magnitude(centroid);

  function cosineDistance(v: number[]): number {
    let dot = 0;
    for (let i = 0; i < dim; i++) dot += v[i] * centroid[i];
    const denom = magnitude(v) * cMag;
    if (denom === 0) return 1;
    return 1 - dot / denom;
  }

  const scored = vectors
    .map((v) => ({ ...v, distance: cosineDistance(v.v) }))
    .sort((a, b) => b.distance - a.distance);

  // Threshold: top 10% by distance, capped at 3 findings. Skip if the
  // far-outliers don't really stand out (max distance < 0.35 = the
  // account just has a pretty narrow voice, nothing to flag).
  const maxDist = scored[0]?.distance ?? 0;
  if (maxDist < 0.35) return [];

  const driftCount = Math.min(3, Math.max(1, Math.floor(scored.length / 10)));
  return scored.slice(0, driftCount).map((s): AuditFinding => {
    const preview = s.content.slice(0, 100).replace(/\s+/g, " ").trim();
    return {
      kind: "voice_drift",
      severity: s.distance > 0.45 ? "medium" : "low",
      title: `Brand-voice outlier creative`,
      body: `This creative reads off-brand vs the account's top performers (cosine distance ${s.distance.toFixed(2)}). Worth a sanity check — was it intentional? Excerpt: "${preview}…"`,
      entity: { type: "creative", id: s.sourceId, name: preview },
      metrics: { distance: s.distance },
    };
  });
}

// ── Executive summary ──────────────────────────────────────────────────

async function generateAuditSummary(input: {
  accountName: string;
  businessName: string;
  findings: AuditFinding[];
}): Promise<string> {
  if (input.findings.length === 0) {
    return `No issues flagged for ${input.accountName} — naming, budget allocation, URL tracking, and brand voice all look clean.`;
  }

  const block = input.findings
    .slice(0, 15)
    .map(
      (f) =>
        `  • [${f.severity}] ${f.title}: ${f.body.replace(/\s+/g, " ").slice(0, 200)}`,
    )
    .join("\n");

  const system = `You are a senior media buyer writing a one-paragraph executive summary at the top of an account audit. Read the findings list and write 2–3 short sentences for the strategist.

Rules:
- Lead with the most important issue. Don't list everything — that's what the findings table below does.
- Plain English. No clichés ("crushed it", "synergy").
- If the most severe issue is "high" budget mis-allocation, lead with that.
- 2–3 sentences max. Tight.`;

  const userPrompt = `Account: ${input.businessName} — ${input.accountName}

Findings:
${block}

Write the exec summary.`;

  return complete(userPrompt, {
    system,
    // Short 2–3 sentence narrative over a short bullet list — mini is fine.
    model: "gpt-4o-mini",
    temperature: 0.4,
    maxTokens: 200,
  });
}
