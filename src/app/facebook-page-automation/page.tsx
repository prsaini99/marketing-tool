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
 * Facebook half of the conversation engine. Targets "facebook page
 * automation", "facebook messenger automation" and "facebook comment auto
 * reply". The engine already handles Pages the same way it handles
 * Instagram, since src/lib/meta/messaging.ts is Page-scoped for both. This
 * page exists because that capability was invisible to search.
 */

export const metadata: Metadata = {
  title: "Facebook Page Automation | Comments and Messenger Replies | adsboys",
  description:
    "Automate Facebook Page comment replies and Messenger conversations with AI that only speaks from your business profile. Messaging windows enforced, links and prices checked, human handoff included. Book a demo.",
  alternates: { canonical: "https://adsboys.com/facebook-page-automation" },
};

const FAQ = [
  {
    q: "What is Facebook Page automation?",
    a: "It replies to comments on your Page posts and ads, and to Messenger conversations, using Meta's official Pages and Messenger APIs. Businesses use it so no comment on a paid post sits unanswered and no message waits overnight.",
  },
  {
    q: "Can it reply to comments on Facebook ads, not just organic posts?",
    a: "Yes. A rule can be scoped to ads only, including dark posts that never appear in your Page feed, or to organic posts, or to specific posts. Ad comments tend to matter most, because that person already responded to something you paid for.",
  },
  {
    q: "How does adsboys stay within Messenger's rules?",
    a: "Automated replies go out inside the standard 24-hour customer service window, and a comment allows exactly one private message within 7 days of it. Both are enforced in code, along with per-person daily caps and a permanent opt-out on 'stop'.",
  },
  {
    q: "Can a human take over a Messenger conversation later?",
    a: "Yes. Your team replies from a staffed inbox, and for conversations past the standard window adsboys uses Meta's Human Agent handling. That path is reachable only from the inbox, so the automated engine cannot use it.",
  },
  {
    q: "Does it work alongside Instagram?",
    a: "Same engine, same rules, same inbox. Facebook Page and Instagram conversations sit side by side, so your team watches one queue instead of two apps.",
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
            Conversation engine · Facebook
          </p>
          <h1
            className="mt-4 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-ink-foreground sm:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Facebook Page automation that answers like your team would
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
            Every comment on your Page posts and ads gets a reply. Messenger
            conversations get answers drawn from the business profile you
            approved, and a person steps in the moment it matters.
          </p>
          <div className="mt-8">
            <DemoCta />
          </div>
        </div>
      </div>

      <Section label="What it handles" title="Comments and Messenger, one engine">
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard title="Comments on ads and posts">
            Reply publicly, privately, or both. Scope a rule to ads only
            (dark posts included), to organic only, or to one campaign&apos;s
            posts. Negative keywords veto a rule, so the bot stays quiet
            where it should.
          </FeatureCard>
          <FeatureCard title="Messenger conversations">
            AI answers from your business description, FAQs and tone rules,
            not from the open internet. Prices and links are checked against
            what you published before anything sends.
          </FeatureCard>
          <FeatureCard title="Windows and consent, enforced">
            A 24-hour reply window. One comment-triggered message inside 7
            days. Per-person daily caps. Permanent opt-out on
            &quot;stop&quot;. All of it in code rather than configuration.
          </FeatureCard>
          <FeatureCard title="Human agent handoff">
            Your team replies from a staffed inbox, using Meta&apos;s Human
            Agent handling for conversations past the standard window. Only
            the inbox can reach that path. The automated engine cannot.
          </FeatureCard>
          <FeatureCard title="Leads, captured in conversation">
            Name, requirement, budget and timeline come out of the chat as it
            happens, so a qualified enquiry arrives as a record instead of a
            transcript somebody has to read.
          </FeatureCard>
          <FeatureCard title="Dry-run before it speaks">
            Test any rule against a made-up comment or message with every
            outbound path stubbed. You approve the wording before a customer
            sees it.
          </FeatureCard>
        </div>
        <p className="mt-8 text-[15px] text-muted">
          Running Instagram too? The same rules power{" "}
          <Link href="/instagram-dm-automation" className="font-medium text-accent hover:underline">
            Instagram DM automation
          </Link>
          , and the{" "}
          <Link href="/comment-to-dm" className="font-medium text-accent hover:underline">
            comment-to-DM flow
          </Link>{" "}
          works identically on both.
        </p>
      </Section>

      <Section label="FAQ" title="Facebook Page automation, answered" tone="surface">
        <Faq items={FAQ} />
        <div className="mt-10">
          <DemoCta label="See it on your Page" />
        </div>
      </Section>

      <SiteFooter />
    </>
  );
}
