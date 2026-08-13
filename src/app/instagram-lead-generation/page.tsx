import type { Metadata } from "next";
import Link from "next/link";
import {
  DemoCta,
  Faq,
  faqJsonLd,
  FeatureCard,
  Section,
  SiteFooter,
  SiteNav,
} from "@/components/marketing/site";

/**
 * Feature page. Target: "instagram lead generation tool" (90 to 140/mo in
 * India, low competition). The current SERP has a scraper and a Chrome
 * extension on page one, which means no serious product page is competing.
 * This names the lead capture the platform already ships.
 */

export const metadata: Metadata = {
  title: "Instagram Lead Generation Tool | From Comments to Qualified Leads | adsboys",
  description:
    "Turn Instagram comments and DMs into lead records with name, requirement, budget and timeline, captured by AI during real conversations. No scraping, no exports. Book a demo.",
  alternates: { canonical: "https://adsboys.com/instagram-lead-generation" },
};

const FAQ = [
  {
    q: "How does adsboys generate leads from Instagram?",
    a: "Your ads and posts produce comments and DMs. The conversation engine answers them, and as the chat goes on it pulls out name, requirement, budget and timeline into a lead record. Leads move from new to engaged to qualified, and the moment one qualifies it is flagged to your team's inbox.",
  },
  {
    q: "Is this a scraper or follower-export tool?",
    a: "No. Scrapers collect profiles of people who never spoke to you, which is both a spam problem and a policy one. adsboys only creates a lead from an actual two-way conversation with your business, through Meta's official APIs.",
  },
  {
    q: "Does the bot keep asking customers the same questions?",
    a: "No. The lead record is the bot's memory. Once a budget or requirement is captured, the AI can see it and stops asking again. That is the difference between a conversation and a form.",
  },
  {
    q: "What happens when a lead qualifies?",
    a: "Moving into 'qualified' flags the thread to your inbox, so a person picks up the warmest conversations at the right moment. The bot does not try to close anything.",
  },
  {
    q: "Can this run on ads specifically?",
    a: "Yes. Reply rules can be scoped to ads only, including dark posts, or to organic only, or to specific posts, so a lead-gen campaign gets its own handling.",
  },
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
            Lead engine
          </p>
          <h1
            className="mt-4 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-ink-foreground sm:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            The Instagram lead generation tool that actually talks to people
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
            The conversations your ads already start become structured lead
            records, captured while the chat is happening and handed to a
            person the moment one qualifies. Nothing is scraped and nobody
            fills in a form.
          </p>
          <div className="mt-8">
            <DemoCta />
          </div>
        </div>
      </div>

      <Section label="The pipeline" title="From a comment to a qualified lead">
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard title="Start from your ads">
            Ads-only rules catch every comment on a lead campaign, including
            dark posts that never show up in your feed, then open a DM inside
            Meta&apos;s 7-day window.
          </FeatureCard>
          <FeatureCard title="Capture while chatting">
            Name, company, requirement, budget and timeline come out of
            ordinary conversation into a lead record. Nothing already known
            gets asked twice.
          </FeatureCard>
          <FeatureCard title="Hand off at the right moment">
            The instant a lead qualifies, the thread is flagged to your inbox
            for a person to close. Complaints route the same way, and just as
            quickly.
          </FeatureCard>
        </div>
        <p className="mt-8 text-[15px] text-muted">
          Built on the same engine as our{" "}
          <Link href="/instagram-dm-automation" className="font-medium text-accent hover:underline">
            Instagram DM automation
          </Link>
          , with the same guardrails, the same windows compliance and the
          same inbox.
        </p>
      </Section>

      <Section label="FAQ" title="Instagram lead generation, answered" tone="surface">
        <Faq items={FAQ} />
        <div className="mt-10">
          <DemoCta label="Watch it qualify a lead" />
        </div>
      </Section>

      <SiteFooter />
    </>
  );
}
