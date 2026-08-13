/**
 * "Improve this ad" — the closed loop, in one call.
 *
 * Takes an underperforming ad and returns: what its own numbers say, what
 * this account's winners do differently, rewritten copy grounded in both,
 * and a pre-flight score on the rewrite. Everything the operator needs to
 * decide, in one place, with evidence attached.
 *
 * THIS SERVICE IS READ-ONLY. It calls the LLM and the local mirror and
 * writes nothing — not to Meta, not to Postgres. Launching the rewrite is a
 * separate, explicitly-confirmed action through the existing create-ad flow.
 *
 * That separation is deliberate rather than unfinished. Auto-launching a
 * rewrite means three chained Meta writes: create a creative, duplicate the
 * ad, repoint the duplicate at the new creative. There is no transaction
 * across those — a failure at step three leaves an orphaned creative and a
 * duplicate ad still carrying the OLD copy, which is worse than not having
 * the button, because it looks like it worked. Every other write path in
 * this codebase is a single audited call for the same reason. When this does
 * get built it needs its own rollback story; it should not be smuggled in as
 * a side effect of a "suggest improvements" feature.
 *
 * The diagnosis is computed from the mirror, NOT asked of the model. Letting
 * an LLM narrate "CTR fell 40%" invites it to invent the 40%. Numbers come
 * from InsightsSnapshot; the model only writes copy.
 */

import { prisma } from "@/lib/db/prisma";
import { generateAdCopy, type AdCopyVariant } from "./generate-ad-copy";
import { runPreflight } from "./preflight";
import type { PreflightCheck, PreflightSummary } from "@/lib/preflight";
import { HOOK_LABELS, type HookType } from "@/lib/creative-taxonomy";

const WINDOW_DAYS = 30;
/** Ads below this spend haven't earned a verdict yet. */
const MIN_SPEND_CENTS = 50_00;

export interface AdDiagnosis {
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenueCents: number;
  ctr: number;
  cpaCents: number | null;
  roas: number | null;
  daysWithData: number;
  /** Last day of the window, ISO date. May be well before today when the
      account's insights sync has fallen behind, and the UI must show it. */
  windowEnd: string;
  windowDays: number;
  /** Account medians over the same window, for context. */
  accountCtr: number;
  accountCpaCents: number | null;
  /** Plain-English findings, computed from the numbers above. */
  findings: string[];
  hookType: string | null;
  hookLabel: string | null;
}

export interface ImproveAdResult {
  ad: { metaAdId: string; name: string };
  original: {
    headline: string | null;
    primaryText: string | null;
    description: string | null;
    callToAction: string | null;
    linkUrl: string | null;
  };
  diagnosis: AdDiagnosis;
  variants: AdCopyVariant[];
  /** Pre-flight on the FIRST variant — the one the UI leads with. */
  preflight: { summary: PreflightSummary; checks: PreflightCheck[] } | null;
  groundedIn: { voice: number; winners: number };
}

function safeDiv(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

/**
 * Turn numbers into findings.
 *
 * Every string here is derived from a comparison that was actually computed
 * — there is no branch that produces a claim the data doesn't support. That
 * matters because these findings become the brief the copy generator is
 * steered by: a hallucinated diagnosis would produce copy that "fixes" a
 * problem the ad never had.
 */
function buildFindings(
  d: Omit<AdDiagnosis, "findings">,
  currencySymbol: string,
): string[] {
  const out: string[] = [];
  const money = (c: number) => `${currencySymbol}${Math.round(c / 100).toLocaleString()}`;

  if (d.spendCents === 0) {
    out.push(
      `No delivery in the ${WINDOW_DAYS} days to ${d.windowEnd}, so there is nothing to diagnose from.`,
    );
    return out;
  }
  if (d.spendCents < MIN_SPEND_CENTS) {
    out.push(
      `Only ${money(d.spendCents)} spent in the ${WINDOW_DAYS} days to ${d.windowEnd}, too little to judge performance yet.`,
    );
    return out;
  }

  if (d.accountCtr > 0) {
    const ratio = safeDiv(d.ctr, d.accountCtr);
    if (ratio < 0.7) {
      out.push(
        `CTR is ${(d.ctr * 100).toFixed(2)}%, well below the account average of ${(d.accountCtr * 100).toFixed(2)}%, so the hook isn't earning the click.`,
      );
    } else if (ratio > 1.3) {
      out.push(
        `CTR is ${(d.ctr * 100).toFixed(2)}%, above the account average of ${(d.accountCtr * 100).toFixed(2)}%, so the hook is working.`,
      );
    }
  }

  if (d.conversions === 0 && d.clicks > 0) {
    out.push(
      `${d.clicks.toLocaleString()} clicks and no conversions. The click is happening but the promise isn't converting.`,
    );
  } else if (d.cpaCents != null && d.accountCpaCents != null) {
    const ratio = safeDiv(d.cpaCents, d.accountCpaCents);
    if (ratio > 1.3) {
      out.push(
        `CPA is ${money(d.cpaCents)} against an account average of ${money(d.accountCpaCents)}, ${Math.round((ratio - 1) * 100)}% more expensive per conversion.`,
      );
    } else if (ratio < 0.7) {
      out.push(
        `CPA is ${money(d.cpaCents)} against an account average of ${money(d.accountCpaCents)}, cheaper than typical.`,
      );
    }
  }

  if (d.roas != null && d.roas > 0 && d.roas < 1) {
    out.push(
      `ROAS is ${d.roas.toFixed(2)}x, so this ad is returning less than it costs.`,
    );
  }

  if (d.hookLabel) {
    out.push(`Current hook reads as "${d.hookLabel}".`);
  }

  if (out.length === 0) {
    out.push("No clear weakness in the numbers. This is a variation, not a rescue.");
  }
  return out;
}

export async function improveAd(
  metaAdId: string,
  opts: { count?: number } = {},
): Promise<ImproveAdResult> {
  const ad = await prisma.ad.findFirst({
    where: { metaAdId, adAccount: { selectedForSync: true } },
    include: {
      adAccount: {
        select: { id: true, metaAdAccountId: true, currency: true },
      },
    },
  });
  if (!ad) throw new Error("Ad not found in any selected-for-sync account");

  const account = ad.adAccount;
  const symbol =
    account.currency === "INR"
      ? "₹"
      : account.currency === "USD"
        ? "$"
        : account.currency === "EUR"
          ? "€"
          : account.currency === "GBP"
            ? "£"
            : "";

  const creative = ad.metaCreativeId
    ? await prisma.adCreative.findFirst({
        where: { adAccountId: account.id, metaCreativeId: ad.metaCreativeId },
        select: {
          title: true,
          body: true,
          linkUrl: true,
          callToActionType: true,
        },
      })
    : null;

  // Anchor the window to the most recent insights day for this account, not
  // to today — the same approach detect-anomalies.ts takes.
  //
  // Anchoring to wall-clock time means an account whose sync has fallen
  // behind reports every ad as "₹0 spent, too little to judge", which is
  // both useless and actively misleading: the ad may have months of
  // delivery, just none of it inside a window measured from a clock the data
  // never caught up to. `windowEnd` is returned so the UI can state the real
  // period rather than implying it is current.
  const latest = await prisma.insightsSnapshot.findFirst({
    where: { adAccountId: account.id, level: "ad" },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const windowEnd = latest?.date ?? new Date();
  const since = new Date(windowEnd);
  since.setUTCDate(since.getUTCDate() - WINDOW_DAYS);

  // This ad's own numbers, and the account's, over the same window — so the
  // comparison is like-for-like rather than against a different period.
  const [adRows, accountRows] = await Promise.all([
    prisma.insightsSnapshot.findMany({
      where: {
        adAccountId: account.id,
        level: "ad",
        entityId: metaAdId,
        date: { gte: since, lte: windowEnd },
      },
      select: {
        date: true,
        spendCents: true,
        impressions: true,
        clicks: true,
        conversionsCount: true,
        revenueCents: true,
      },
    }),
    prisma.insightsSnapshot.aggregate({
      where: { adAccountId: account.id, level: "ad", date: { gte: since, lte: windowEnd } },
      _sum: {
        spendCents: true,
        impressions: true,
        clicks: true,
        conversionsCount: true,
      },
    }),
  ]);

  const totals = adRows.reduce(
    (acc, r) => ({
      spendCents: acc.spendCents + r.spendCents,
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      conversions: acc.conversions + r.conversionsCount,
      revenueCents: acc.revenueCents + r.revenueCents,
    }),
    { spendCents: 0, impressions: 0, clicks: 0, conversions: 0, revenueCents: 0 },
  );

  const accSpend = accountRows._sum.spendCents ?? 0;
  const accClicks = accountRows._sum.clicks ?? 0;
  const accImpressions = accountRows._sum.impressions ?? 0;
  const accConversions = accountRows._sum.conversionsCount ?? 0;

  // The creative's classification tag, when B.2 has run for this account.
  let hookType: string | null = null;
  if (ad.metaCreativeId) {
    const emb = (await prisma.embedding.findFirst({
      where: {
        namespace: "ads",
        sourceType: "AdCreative",
        adAccountId: account.id,
        sourceId: ad.metaCreativeId,
      },
      select: { metadata: true },
    })) as unknown as { metadata: Record<string, unknown> | null } | null;
    const t = emb?.metadata?.hookType;
    if (typeof t === "string") hookType = t;
  }

  const partial: Omit<AdDiagnosis, "findings"> = {
    ...totals,
    ctr: safeDiv(totals.clicks, totals.impressions),
    cpaCents:
      totals.conversions > 0
        ? Math.round(totals.spendCents / totals.conversions)
        : null,
    roas: totals.spendCents > 0 ? totals.revenueCents / totals.spendCents : null,
    daysWithData: new Set(adRows.map((r) => r.date.toISOString().slice(0, 10))).size,
    windowEnd: windowEnd.toISOString().slice(0, 10),
    windowDays: WINDOW_DAYS,
    accountCtr: safeDiv(accClicks, accImpressions),
    accountCpaCents:
      accConversions > 0 ? Math.round(accSpend / accConversions) : null,
    hookType,
    hookLabel: hookType ? (HOOK_LABELS[hookType as HookType] ?? hookType) : null,
  };

  const diagnosis: AdDiagnosis = {
    ...partial,
    findings: buildFindings(partial, symbol),
  };

  // The brief IS the diagnosis. Handing the generator the findings rather
  // than the raw ad is what makes the rewrite targeted — otherwise it just
  // paraphrases what is already there.
  const brief = [
    `Rewrite this underperforming ad for the same product and audience.`,
    ``,
    `CURRENT AD`,
    creative?.title ? `Headline: ${creative.title}` : "",
    creative?.body ? `Primary text: ${creative.body}` : "",
    creative?.callToActionType ? `CTA: ${creative.callToActionType}` : "",
    ``,
    `WHAT THE NUMBERS SAY`,
    ...diagnosis.findings.map((f) => `- ${f}`),
    ``,
    `Keep the same offer and audience. Address the weaknesses above:`,
    `especially the hook if CTR is the problem. Do not invent claims,`,
    `prices, or guarantees that are not in the current ad.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  const generated = await generateAdCopy({
    metaAdAccountId: account.metaAdAccountId,
    brief,
    count: Math.max(1, Math.min(5, opts.count ?? 3)),
  });

  // Pre-flight the variant the UI leads with. Failing here must not lose the
  // variants — the rewrite is still useful without a score.
  let preflight: ImproveAdResult["preflight"] = null;
  const first = generated.variants[0];
  if (first) {
    try {
      preflight = await runPreflight({
        adAccountId: account.id,
        headline: first.headline,
        primaryText: first.primaryText,
        description: first.description,
        callToAction: creative?.callToActionType ?? undefined,
        linkUrl: creative?.linkUrl ?? undefined,
        // The rewrite proposes copy, not a destination — the link comes from
        // the ad being improved.
        linkIsProposed: false,
      });
    } catch (e) {
      console.error("[improve-ad] preflight failed:", e);
    }
  }

  return {
    ad: { metaAdId: ad.metaAdId, name: ad.name },
    original: {
      headline: creative?.title ?? null,
      primaryText: creative?.body ?? null,
      description: null,
      callToAction: creative?.callToActionType ?? null,
      linkUrl: creative?.linkUrl ?? null,
    },
    diagnosis,
    variants: generated.variants,
    preflight,
    groundedIn: {
      voice: generated.groundedIn.voice.length,
      winners: generated.groundedIn.winners.length,
    },
  };
}
