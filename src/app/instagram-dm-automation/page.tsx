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
 * Pillar page. Target keyword: "instagram dm automation" (720/mo in India,
 * growing, weak SERP) plus its "tools" sibling. Written for a business
 * evaluator rather than a creator, so the argument is governance, windows
 * compliance and human handoff instead of emoji flows.
 */

export const metadata: Metadata = {
  title: "Instagram DM Automation for Businesses | adsboys",
  description:
    "Automate Instagram DMs and comment replies with AI that only speaks from your approved business profile. Meta messaging windows enforced, links and prices checked before sending, human handoff built in. Book a demo.",
  alternates: { canonical: "https://adsboys.com/instagram-dm-automation" },
};

const FAQ = [
  {
    q: "What is Instagram DM automation?",
    a: "It replies to direct messages and comment-triggered conversations on your professional account, through Meta's official messaging APIs. Businesses use it so common questions get answered in seconds, no comment goes ignored, and leads get qualified without someone watching the inbox at 11pm.",
  },
  {
    q: "Is DM automation allowed by Instagram?",
    a: "Yes, provided it runs on Meta's official APIs and respects the messaging windows. Automated replies must land within 24 hours of the person's message, and a comment allows exactly one private message within 7 days. adsboys enforces both in code, along with per-person daily caps and opt-out handling.",
  },
  {
    q: "How is adsboys different from flow-builder tools?",
    a: "Flow builders make you script every branch in advance. adsboys uses your approved rules first, then lets AI answer whatever the rules did not anticipate, drawing only on your business profile. Before any generated reply sends, it is checked: approved links and published prices only. Anything else is dropped.",
  },
  {
    q: "What happens to complaints or complex questions?",
    a: "The engine watches for complaints, conversations where the AI could not answer, and leads that just qualified. Those get flagged to an inbox your team works from. One click takes the thread over and the bot stays silent on it until you hand it back.",
  },
  {
    q: "Does it work for Facebook Pages too?",
    a: "Yes. The same engine covers Facebook Page comments and Messenger, using the same rules, guardrails and inbox.",
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
            Conversation engine
          </p>
          <h1
            className="mt-4 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-ink-foreground sm:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Instagram DM automation, built for businesses
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
            Answer every DM and comment on your ads and posts. The AI speaks
            only from the business profile you approved, stays inside
            Meta&apos;s messaging rules, and hands the hard ones to a person.
          </p>
          <div className="mt-8">
            <DemoCta />
          </div>
        </div>
      </div>

      <Section
        label="How it works"
        title="Your rules run first, AI covers the rest"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard title="Comment to DM, compliantly">
            A comment on your ad or post can trigger a public reply, a private
            DM, or both. Scope a rule to one post, to ads only, or to organic
            only. Keyword matching is whole-word, so a rule on
            &quot;AI&quot; never fires on &quot;Airtel&quot;.
          </FeatureCard>
          <FeatureCard title="AI grounded in your profile">
            When no rule fits, AI answers from your business description,
            FAQs and tone rules. The reply is then checked: approved links
            and published prices only. One that fails never sends.
          </FeatureCard>
          <FeatureCard title="Windows enforced in code">
            Thread replies stay inside the 24-hour window. Comment-triggered
            DMs stay inside the 7-day one. Per-person caps and instant opt-out
            on &quot;stop&quot; are always on. None of it is a setting someone
            can forget to tick.
          </FeatureCard>
          <FeatureCard title="Lead capture as you chat">
            Name, requirement, budget and timeline get pulled out of the
            conversation into a lead record. The bot stops asking for anything
            it already has.
          </FeatureCard>
          <FeatureCard title="Human handoff inbox">
            Complaints, stuck threads and newly qualified leads land in a
            staffed inbox. Take any thread over in one click and hand it back
            when you are done.
          </FeatureCard>
          <FeatureCard title="Test before you trust">
            Test any rule against a made-up comment or DM with every outbound
            path stubbed out. You read what the bot would have said before a
            customer does.
          </FeatureCard>
        </div>
        <p className="mt-8 text-[15px] text-muted">
          Comparing tools? Read{" "}
          <Link href="/manychat-alternative" className="font-medium text-accent hover:underline">
            how adsboys differs from ManyChat
          </Link>{" "}
          or see how conversations become{" "}
          <Link href="/instagram-lead-generation" className="font-medium text-accent hover:underline">
            qualified leads
          </Link>
          .
        </p>
      </Section>

      <Section label="FAQ" title="Instagram DM automation, answered" tone="surface">
        <Faq items={FAQ} />
        <div className="mt-10">
          <DemoCta label="See it on your account" />
        </div>
      </Section>

      <SiteFooter />
    </>
  );
}
