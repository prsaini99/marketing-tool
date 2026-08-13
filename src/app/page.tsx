import type { Metadata } from "next";
import Link from "next/link";
import {
  Bot,
  Wand2,
  Gauge,
  Inbox,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
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
 * adsboys.com homepage.
 *
 * This route used to redirect to /dashboard. The app now lives under
 * /dashboard and the root is the public face.
 *
 * Written for someone evaluating adsboys after a referral or a comparison
 * search. The job is credibility and a booked demo, so there is no pricing
 * grid and nothing that says "start free".
 */

export const metadata: Metadata = {
  title: "adsboys | Managed Meta Ads Platform for Agencies and In-House Teams",
  description:
    "One place to run Meta campaigns, learn what works from your own results, and answer the comments and DMs your ads bring in. Set up and operated for you. Book a demo.",
  alternates: { canonical: "https://adsboys.com/" },
  openGraph: {
    title: "adsboys | Managed Meta Ads Platform",
    description:
      "Run campaigns, learn from your own results, and answer the people your ads bring in.",
    url: "https://adsboys.com/",
    siteName: "adsboys",
    type: "website",
  },
};

const FAQ = [
  {
    q: "What is adsboys?",
    a: "adsboys is a Meta ads platform we set up and operate for you. It pulls your ad accounts into one dashboard, uses AI to read your creatives and score new ones before launch, watches for problems daily, and answers the Instagram and Facebook conversations your ads produce.",
  },
  {
    q: "Is adsboys self-serve software?",
    a: "No. Each client gets a dedicated deployment that we connect, configure and maintain. We build your bot profile, reply rules and alert thresholds with your team during onboarding, then hand over a working system. Your team runs the day to day work.",
  },
  {
    q: "Can the AI invent a price or a link when it replies to a customer?",
    a: "No, and the reason is not that we asked it nicely. Every generated reply is checked before it sends. Only links you approved and prices published in your business profile are allowed through. Anything else is dropped.",
  },
  {
    q: "What happens when a conversation needs a person?",
    a: "Complaints, stuck conversations and newly qualified leads get flagged to an inbox your team works from. One click takes over the thread. The bot goes quiet on that conversation until you hand it back.",
  },
  {
    q: "Which platforms does adsboys cover?",
    a: "Meta advertising, so Facebook and Instagram campaigns, ad sets, ads, creatives, audiences and insights. It also handles comments and DMs on Instagram and Facebook Pages. WhatsApp Business automation is next on the roadmap.",
  },
];

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "adsboys",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            description:
              "Managed Meta ads platform for agencies and in-house teams. Campaign management, AI creative analysis, and Instagram and Facebook conversation automation.",
            offers: {
              "@type": "Offer",
              price: "0",
              priceCurrency: "INR",
              description: "Custom pricing. Book a demo.",
            },
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(FAQ)) }}
      />

      <SiteNav />

      <div className="chrome-rail">
        <div className="mx-auto w-full max-w-6xl px-5 pb-20 pt-16">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-glow">
            For agencies and in-house teams running Meta ads
          </p>
          <h1
            className="mt-4 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-ink-foreground sm:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Every ad you run makes the next one better.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
            Describe a campaign and get a plan built from your own account.
            Launch it, learn what worked, and answer the people it brings in,
            all in one place. We set it up and operate it. Your team makes the
            calls.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <DemoCta />
            <Link
              href="/instagram-dm-automation"
              className="text-sm font-medium text-ink-muted underline-offset-4 hover:text-ink-foreground hover:underline"
            >
              See how the conversation engine works
            </Link>
          </div>
          <dl className="mt-14 grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              ["Plan in English", "the copilot drafts, you approve"],
              ["Governed AI", "replies checked for links and prices"],
              ["Human inbox", "take over any conversation in one click"],
              ["Dedicated", "your own instance, your own database"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt
                  className="text-lg font-bold text-ink-foreground"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {k}
                </dt>
                <dd className="mt-1 text-xs leading-relaxed text-ink-subtle">
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <Section
        label="The loop"
        title="Plan, launch, measure and reply in one platform"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard title="Describe it, get a plan">
            <Wand2 className="mb-2 h-5 w-5 text-accent" aria-hidden />
            Say what you want in plain English and the copilot researches your
            account before answering. It searches your creative library by what
            each asset actually shows or says, reads how your past campaigns
            performed, and comes back with a full campaign: ad sets, budgets,
            targeting and copy. Every plan is checked against Meta&apos;s rules
            first, so the incompatible pairings that fail halfway through a
            launch are caught before you see them. You edit any field, or the
            raw JSON, and approve.
          </FeatureCard>
          <FeatureCard title="Know before you launch">
            <Gauge className="mb-2 h-5 w-5 text-accent" aria-hidden />
            adsboys scores a draft ad before you spend anything on it. It
            reviews the copy against Meta&apos;s policies, estimates CPA from
            ads you have already run that resemble it, and tells you when
            you&apos;re about to ship your ninth statement-style hook this
            month. The comparison set is your account, not an industry
            benchmark.
          </FeatureCard>
          <FeatureCard title="AI that studies your winners">
            <Sparkles className="mb-2 h-5 w-5 text-accent" aria-hidden />
            Every image is described by a vision model and every video with a
            downloadable file is transcribed, so the platform knows what your
            creatives actually show and say rather than their filenames. Those
            descriptions drive classification by hook, angle and funnel stage,
            joined to real spend and CPA. One click rewrites a weak ad in the
            style of the ones that worked.
          </FeatureCard>
          <FeatureCard title="Rules that watch the budget">
            <Zap className="mb-2 h-5 w-5 text-accent" aria-hidden />
            Set a threshold, such as pause anything over ₹500 CPA for three
            days, and adsboys enforces it. Spend floors stop a rule acting on
            noise, and it refuses to judge a window where the data is missing.
            Anomaly alerts arrive by email each morning.
          </FeatureCard>
          <FeatureCard title="Answer every comment and DM">
            <Bot className="mb-2 h-5 w-5 text-accent" aria-hidden />
            The conversation engine replies to Instagram and Facebook comments
            and messages using rules you approve, with AI filling the gaps from
            your business profile. Meta&apos;s messaging windows, per-person
            daily caps and opt-out handling are built in.
          </FeatureCard>
          <FeatureCard title="A person, one click away">
            <Inbox className="mb-2 h-5 w-5 text-accent" aria-hidden />
            Angry customers, questions the bot could not answer, and leads that
            just qualified all get flagged to a staffed inbox. Your team takes
            the thread over instantly and the bot stays out of it until you say
            otherwise.
          </FeatureCard>
          <FeatureCard title="Built to survive a security review">
            <ShieldCheck className="mb-2 h-5 w-5 text-accent" aria-hidden />
            Separate deployment per client. Encrypted credentials. Every write
            logged before it reaches Meta. Confirmation on anything that moves
            money.{" "}
            <Link href="/security" className="font-medium text-accent hover:underline">
              Read the detail
            </Link>
            .
          </FeatureCard>
        </div>
      </Section>

      <Section
        label="How we work"
        title="You get a working system, not a login"
        tone="surface"
      >
        <ol className="grid gap-6 md:grid-cols-3">
          {[
            [
              "1. Connect",
              "You grant access to specific ad accounts and Pages from your own Business Manager, at whatever permission level you are comfortable with. Read-only is a fine place to start. We mirror those accounts into your instance.",
            ],
            [
              "2. Configure",
              "In an onboarding sprint we build your bot profile, reply rules, alert thresholds and budget guardrails with your team, then dry-run all of it against test messages before anything goes live.",
            ],
            [
              "3. Run",
              "Your team works the deck daily. We keep the platform current as Meta changes things underneath it, which happens more often than anyone would like.",
            ],
          ].map(([t, d]) => (
            <li key={t} className="rounded-xl border border-border bg-background p-6">
              <h3
                className="text-lg font-semibold"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {t}
              </h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10">
          <DemoCta label="Book a walkthrough" />
        </div>
      </Section>

      <Section label="Questions" title="What people ask before buying">
        <Faq items={FAQ} />
      </Section>

      <SiteFooter />
    </>
  );
}
