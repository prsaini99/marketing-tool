import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown } from "lucide-react";
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
 * Narrow feature page for "comment to dm" and "comment to dm instagram".
 * Low volume, but setsmart.io ranks with this exact page shape, and it is
 * the mechanic most people mean when they say "DM automation": someone
 * comments a keyword, the bot answers publicly and privately.
 */

export const metadata: Metadata = {
  title: "Comment-to-DM Automation for Instagram & Facebook | adsboys",
  description:
    "Turn comments on your posts and ads into private conversations. A public reply plus a DM inside Meta's 7-day window, with keyword rules, ad-only scoping and human handoff.",
  alternates: { canonical: "https://adsboys.com/comment-to-dm" },
};

const FAQ = [
  {
    q: "What is comment-to-DM automation?",
    a: "Someone comments on your Instagram or Facebook post, often with a keyword you asked for such as 'PRICE'. The system replies publicly under that comment and sends the person a private message with what they wanted. Public interest becomes a private conversation you can track.",
  },
  {
    q: "Is comment-to-DM allowed by Meta?",
    a: "Yes, through the official APIs and inside one specific rule. A comment permits exactly one private message, sent within 7 days of it. adsboys enforces that window in code and skips a DM that falls outside rather than risk the account.",
  },
  {
    q: "Can I trigger it only on ads, not every post?",
    a: "Yes. Each rule can be scoped to ads only, including dark posts that never appear in your feed, or to organic posts, or to one post, or to everything. Ad comments are usually where the value sits, because that person already responded to paid media.",
  },
  {
    q: "How do you avoid replying to the wrong comments?",
    a: "Keyword matching is whole-word and case-insensitive, never substring, so a rule on 'AI' does not fire on 'Airtel' or 'said'. Negative keywords veto a rule outright, and an intent filter skips emoji-only or single-word comments like 'nice' that asked for nothing.",
  },
  {
    q: "What if the public reply promises a DM that fails to send?",
    a: "The public reply only claims a DM was sent when one actually was. The DM is attempted first and the public wording follows the real outcome, so your Page never promises something the customer did not receive.",
  },
];

const STEPS: Array<[string, string]> = [
  [
    "Someone comments on your post or ad",
    "A keyword you chose, or any comment at all if you prefer. Whole-word matching means only real mentions count.",
  ],
  [
    "adsboys replies publicly",
    "In your voice, from a template or from AI using your business profile, so the thread looks answered to everyone reading it.",
  ],
  [
    "And opens a private DM",
    "Inside the 7-day comment window, once per person, with the link or answer they asked for. There is never a second unsolicited message.",
  ],
  [
    "The conversation continues, or a human takes it",
    "Follow-up questions get answered inside the 24-hour window. Complaints and qualified leads are flagged to your inbox for a person.",
  ],
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
            The core mechanic
          </p>
          <h1
            className="mt-4 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-ink-foreground sm:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Comment-to-DM, without the compliance risk
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
            Turn a comment on your ad into a private conversation. Public
            reply and DM together, inside Meta&apos;s rules, with a person
            waiting for the ones that matter.
          </p>
          <div className="mt-8">
            <DemoCta />
          </div>
        </div>
      </div>

      <Section label="The flow" title="What happens, step by step">
        <ol className="mx-auto max-w-2xl space-y-3">
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <div className="rounded-xl border border-border bg-surface p-5">
                <div className="flex items-baseline gap-3">
                  <span
                    className="text-sm font-bold text-accent"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    0{i + 1}
                  </span>
                  <h3 className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                    {t}
                  </h3>
                </div>
                <p className="mt-1.5 pl-8 text-[15px] leading-relaxed text-muted">{d}</p>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex justify-center py-1.5">
                  <ArrowDown className="h-4 w-4 text-subtle" aria-hidden />
                </div>
              )}
            </li>
          ))}
        </ol>
      </Section>

      <Section
        label="Guardrails"
        title="Why businesses can run this unattended"
        tone="surface"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard title="One message, one comment">
            Meta permits a single private message per comment, within 7 days.
            The engine enforces both. A DM outside the window is skipped and
            logged rather than attempted.
          </FeatureCard>
          <FeatureCard title="Never a fabricated promise">
            The public reply only says &quot;check your DMs&quot; when the DM
            genuinely sent. The wording follows the outcome, not the plan.
          </FeatureCard>
          <FeatureCard title="Caps and opt-out">
            Per-person daily limits stop repeat messaging, and a
            &quot;stop&quot; permanently silences automation for that person.
            No exceptions and no re-subscription loophole.
          </FeatureCard>
        </div>
        <p className="mt-8 text-[15px] text-muted">
          Works identically on{" "}
          <Link href="/instagram-dm-automation" className="font-medium text-accent hover:underline">
            Instagram
          </Link>{" "}
          and{" "}
          <Link href="/facebook-page-automation" className="font-medium text-accent hover:underline">
            Facebook Pages
          </Link>
          .
        </p>
      </Section>

      <Section label="FAQ" title="Comment-to-DM, answered">
        <Faq items={FAQ} />
        <div className="mt-10">
          <DemoCta />
        </div>
      </Section>

      <SiteFooter />
    </>
  );
}
