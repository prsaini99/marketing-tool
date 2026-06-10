/**
 * Weekly performance report — LLM narration over the aggregated context.
 *
 * Workflow:
 *   1. buildWeeklyReportContext() → totals + WoW deltas + top campaigns.
 *   2. Pre-format the context as a compact JSON-ish text block (cheaper
 *      and clearer for the model than a JSON.stringify dump).
 *   3. Call the LLM with a system prompt that pins the report shape:
 *      a one-paragraph headline → Summary → Wins → Needs attention →
 *      Next-week priorities. Markdown only. No filler.
 *
 * Returns markdown — the Reports page renders it directly. The structured
 * `context` comes back too so the UI can show the underlying numbers next
 * to the narrative (transparency: "here's what we read, here's what we
 * said about it").
 */

import { complete } from "@/lib/llm/chat";
import {
  buildWeeklyReportContext,
  type ReportContext,
} from "./report-context";

export interface WeeklyReport {
  markdown: string;
  context: ReportContext;
}

const SYSTEM_PROMPT = `You are a senior media buyer writing a weekly performance report for an agency client. Plain English, no jargon dumps. Be honest — if performance dropped, say so and explain why. Avoid clichés ("crushed it", "knocked it out of the park", "game-changer", "synergy").

Output MUST be valid markdown with EXACTLY these sections, in this order, all H2s:

## Headline
ONE short paragraph (≤ 3 sentences) that summarises the week vs the prior week. Lead with the most important fact (spend up/down, delivery efficiency, etc.). State direction + magnitude.

## Summary
A compact totals block — bulleted list of the 4–6 KPIs that matter (spend, impressions, clicks, CTR, CPM, CPC) with **week-on-week deltas in parentheses**, e.g. "Spend: ₹1,24,500 (+18% WoW)". Use the account's currency symbol.

## Wins
3–5 bullets on what worked. Each bullet names a campaign and a specific number. If nothing genuinely improved, say "No clear wins this week — see Needs attention." Don't manufacture wins.

## Needs attention
3–5 bullets on what underperformed or shifted in the wrong direction. Same shape — name the campaign, cite a number. Be specific about probable causes ("CPM up 40% suggests audience saturation" / "Clicks dropped Wed onwards — landing page or hook issue").

## Next week
2–4 bullets with concrete actions the team should take. Tie each to one of the issues above.

Rules:
- Currency: format integer amounts in the account's currency, comma-separated. Cents come in as integers; divide by 100 for display.
- Percentages: round to whole numbers unless precision matters.
- ROAS: when the context shows a non-zero ROAS, LEAD WITH IT in the Headline — it's the metric clients care about most. When ROAS is 0 OR conversionsCount is 0, the account either has no conversion tracking or no conversions yet this period — explicitly note that ("no conversion data this period") instead of saying ROAS is bad.
- Conversions: when conversionsCount > 0 but revenue is 0, this is a lead-gen / app-install style account — talk in conversions, not money. Cost per conversion = spend / conversions.
- Never invent metrics that weren't in the context.
- When you say "campaigns", distinguish carefully: the ROSTER section has the TOTAL campaign count (active + paused); the CAMPAIGNS section lists only those with activity in this window. Don't claim "only X campaigns exist" when the roster says otherwise.
- If many active campaigns had NO delivery this window (see roster.activeWithoutActivity), flag it under "Needs attention" — it usually means budget exhaustion, audience too narrow, or scheduling issues worth investigating.
- If coverage is thin (fewer than 4 daysWithData), open with a one-line caveat in the Headline section.
- Total length ≤ 350 words. Tight beats long.`;

function formatContextBlock(ctx: ReportContext): string {
  // Currency-agnostic — the LLM is told the currency code; it picks the
  // right symbol. We just hand it the raw cents → / 100 instruction in the
  // prompt + give it pre-divided values too so it has both.
  const fmtMoney = (cents: number) => (cents / 100).toFixed(2);
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

  const t = ctx.totals;
  const c = t.current;
  const p = t.previous;
  const delta = (cur: number, prev: number) =>
    prev > 0
      ? `${(((cur - prev) / prev) * 100).toFixed(0)}%`
      : cur > 0
        ? "new"
        : "0%";

  const camp = ctx.campaigns
    .map((row, i) => {
      const roasPart =
        row.revenueCents > 0
          ? `, ROAS ${row.roas.toFixed(2)}x (revenue ${fmtMoney(row.revenueCents)})`
          : row.conversionsCount > 0
            ? `, conversions ${row.conversionsCount}`
            : "";
      return `  ${i + 1}. "${row.name}" [${row.status}] — spend ${fmtMoney(row.spendCents)} ${ctx.account.currency}, impr ${row.impressions}, clicks ${row.clicks}, CTR ${pct(row.ctr)}, CPM ${fmtMoney(row.cpmCents)} ${ctx.account.currency}, CPC ${fmtMoney(row.cpcCents)} ${ctx.account.currency}${roasPart}`;
    })
    .join("\n");

  const r = ctx.roster;
  const idleNames =
    r.activeWithoutActivitySample.length > 0
      ? r.activeWithoutActivitySample.map((n) => `    - "${n}"`).join("\n") +
        (r.activeWithoutActivity > r.activeWithoutActivitySample.length
          ? `\n    - …and ${r.activeWithoutActivity - r.activeWithoutActivitySample.length} more`
          : "")
      : "    (none)";

  return `ACCOUNT: ${ctx.account.businessName} — ${ctx.account.name}
CURRENCY: ${ctx.account.currency} (amounts below are in major units, not cents)
TIMEZONE: ${ctx.account.timezone}
COVERAGE: ${ctx.coverage.daysWithData} day(s) with data in current window. Last insights sync: ${ctx.coverage.lastSyncedAt ?? "never"}

CURRENT WINDOW: ${ctx.periods.current.from} → ${ctx.periods.current.to}
PREVIOUS WINDOW: ${ctx.periods.previous.from} → ${ctx.periods.previous.to}

ROSTER (the FULL campaign list — use this for "how many campaigns" questions):
  Total campaigns mirrored: ${r.totalCampaigns}
  Active                  : ${r.activeCampaigns}
  Paused                  : ${r.pausedCampaigns}
  Active w/ NO delivery   : ${r.activeWithoutActivity} (active but zero spend/impressions this window)
  Active-no-delivery names (sample):
${idleNames}

TOTALS — CURRENT (week-on-week vs previous in parens):
  Spend       : ${fmtMoney(c.spendCents)} (${delta(c.spendCents, p.spendCents)})
  Impressions : ${c.impressions} (${delta(c.impressions, p.impressions)})
  Clicks      : ${c.clicks} (${delta(c.clicks, p.clicks)})
  CTR         : ${pct(c.ctr)} (was ${pct(p.ctr)})
  CPM         : ${fmtMoney(c.cpmCents)} (was ${fmtMoney(p.cpmCents)})
  CPC         : ${fmtMoney(c.cpcCents)} (was ${fmtMoney(p.cpcCents)})
  Conversions : ${c.conversionsCount} (${delta(c.conversionsCount, p.conversionsCount)})
  Revenue     : ${fmtMoney(c.revenueCents)} (${delta(c.revenueCents, p.revenueCents)})
  ROAS        : ${c.roas.toFixed(2)}x (was ${p.roas.toFixed(2)}x)

CAMPAIGNS WITH ACTIVITY THIS WINDOW (top ${ctx.campaigns.length} by spend):
${camp || "  (no campaign-level activity in this window)"}`;
}

export async function generateWeeklyReport(
  metaAdAccountIdParam: string,
): Promise<WeeklyReport> {
  const context = await buildWeeklyReportContext(metaAdAccountIdParam);
  const contextBlock = formatContextBlock(context);

  const markdown = await complete(`Write the weekly report based on this:\n\n${contextBlock}`, {
    system: SYSTEM_PROMPT,
    temperature: 0.6, // narrative but grounded — too high and it embellishes
    maxTokens: 1400,
  });

  return { markdown, context };
}
