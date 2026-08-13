import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import {
  DemoCta,
  Faq,
  faqJsonLd,
  Section,
  SiteFooter,
  SiteNav,
} from "@/components/marketing/site";

/**
 * Comparison page. Target: "manychat alternative" (~1,100/mo cluster, low
 * competition, and a Reddit thread currently ranks #2, which means Google
 * has no good answer to show). It is also the page every enterprise
 * evaluation silently needs, because "why not just use ManyChat?" always
 * comes up.
 *
 * Honesty is the strategy. ManyChat is genuinely good for creators.
 * Saying so is what makes the business-versus-creator distinction land.
 */

export const metadata: Metadata = {
  title: "ManyChat Alternative for Businesses & Agencies | adsboys",
  description:
    "ManyChat is built for creators who build their own flows. adsboys is a managed alternative for businesses, with AI replies checked before sending, a human handoff inbox, audit trails and onboarding done for you.",
  alternates: { canonical: "https://adsboys.com/manychat-alternative" },
};

const FAQ = [
  {
    q: "Is adsboys a direct ManyChat alternative?",
    a: "For businesses and agencies, yes. Both automate Instagram and Facebook conversations through Meta's official APIs. What differs is the model. ManyChat is self-serve flow building aimed at creators. adsboys is a deployment we set up and run, where AI answers from a business profile you control, and your team gets an inbox, audit trails and onboarding.",
  },
  {
    q: "What does ManyChat do better?",
    a: "Quite a lot. If you want to build a 'comment WORD to get my guide' flow yourself in an afternoon on a free plan, ManyChat is the right choice and we will say so on the call. Its template library and community are far ahead of anything we offer for that use case.",
  },
  {
    q: "Why do businesses outgrow flow builders?",
    a: "Three reasons come up repeatedly. Customers ask things no flow anticipated. Nobody on the team owns keeping the flows current. And an unguarded bot speaking in your brand name starts to look like a risk rather than a shortcut. adsboys handles the unanticipated questions inside fixed guardrails, and we keep the system current with you.",
  },
  {
    q: "Can the AI make something up to a customer?",
    a: "The two expensive cases are blocked outright. Only links on your approved list and prices that appear word for word in your published profile can pass. A reply with anything else never sends. That check is code, not prompt wording, so it holds regardless of what the model decides to write.",
  },
  {
    q: "Does adsboys also manage the ads themselves?",
    a: "Yes. That is the larger platform: campaign management, AI creative analysis, pre-launch ad scoring, budget rules, anomaly alerts and reporting. The conversation engine is one part of it, covering what happens after someone responds to an ad.",
  },
];

const ROWS: Array<[string, string, string]> = [
  ["Built for", "Creators and small teams, self-serve", "Businesses and agencies, managed"],
  ["Setup", "You build flows yourself", "White-glove onboarding sprint"],
  ["Unscripted questions", "Flow dead-ends, or a generic AI add-on", "AI answers from your approved profile"],
  ["Brand safety", "Your flow discipline", "Hard filter: approved links & published prices only"],
  ["Human handoff", "Live-chat seat add-on", "Inbox built in, with complaints and qualified leads flagged"],
  ["Lead capture", "Fields collected by the flow", "Pulled from the conversation, and never re-asked"],
  ["Ads platform", "Not offered", "Full Meta campaign management around it"],
  ["Audit trail", "Not offered", "Every action logged and exportable"],
  ["Pricing", "Freemium, priced per contact", "Custom, quoted per engagement"],
];

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(FAQ)) }}
      />
      <SiteNav />

      <div className="chrome-rail">
        <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-14">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-glow">
            Honest comparison
          </p>
          <h1
            className="mt-4 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-ink-foreground sm:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            A ManyChat alternative for businesses, not creators
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
            ManyChat is very good at what it is for, which is creators
            building their own flows. adsboys is for the point where that
            stops being enough, when the account answering customers carries
            your brand name, your prices and your compliance obligations.
          </p>
          <div className="mt-8">
            <DemoCta label="See the difference on a demo" />
          </div>
        </div>
      </div>

      <Section label="Side by side" title="Where the two tools actually differ">
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[640px] text-[15px]">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-muted">
                  &nbsp;
                </th>
                <th className="px-5 py-4 font-semibold">ManyChat</th>
                <th className="px-5 py-4 font-semibold text-accent">adsboys</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([dim, mc, ab]) => (
                <tr key={dim} className="border-b border-border last:border-0">
                  <td className="px-5 py-3.5 text-sm font-medium text-muted">{dim}</td>
                  <td className="px-5 py-3.5 text-muted">
                    {mc === "Not offered" ? <Minus className="h-4 w-4 text-subtle" aria-label="Not offered" /> : mc}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="flex items-start gap-2">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-success" aria-hidden />
                      {ab}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-muted">
          Short version: pick ManyChat if you want to build and own the flows
          yourself. Pick adsboys if you want the conversations, and the ads
          that start them, run as a managed system with guardrails your legal
          team can actually read. Start with{" "}
          <Link href="/instagram-dm-automation" className="font-medium text-accent hover:underline">
            how our DM automation works
          </Link>
          .
        </p>
      </Section>

      <Section label="FAQ" title="What evaluators ask in this comparison" tone="surface">
        <Faq items={FAQ} />
        <div className="mt-10">
          <DemoCta />
        </div>
      </Section>

      <SiteFooter />
    </>
  );
}
