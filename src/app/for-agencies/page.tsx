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
 * Persona page for our actual segment. Competitors rank persona pages for
 * coaches and course creators. Ours is agencies and in-house teams running
 * several ad accounts, which is the buyer adsboys is priced and built for.
 *
 * The argument is operational rather than feature-led, because what an
 * agency owner fears is a client account failing quietly between reviews.
 */

export const metadata: Metadata = {
  title: "adsboys for Agencies | Run Every Client's Meta Ads From One Deck",
  description:
    "Meta ads management across every client account: alerts that span the portfolio, client-ready AI reports, creative analysis that learns from all your accounts, and an audit trail on every change. Book a demo.",
  alternates: { canonical: "https://adsboys.com/for-agencies" },
};

const FAQ = [
  {
    q: "How does adsboys handle multiple client accounts?",
    a: "Every connected ad account shows up in one view, with a client switcher that filters the whole app. Alerts, reports and the creative playbook all work across accounts, so a small team can watch many clients without opening Ads Manager fifteen times a day.",
  },
  {
    q: "Do clients get their own reports?",
    a: "Yes. Weekly performance reports are written per account as narrative rather than a number dump, and they can go out by email automatically. Alert digests work the same way, so a client hears about a problem from you instead of finding it themselves.",
  },
  {
    q: "Can the AI learn from one client and help another?",
    a: "Within your own portfolio, yes. Hooks and angles that performed for one account inform copy generated for another, weighted by real spend and results. That data stays inside your deployment and is never shared beyond it.",
  },
  {
    q: "Who is accountable when something changes?",
    a: "Every change writes an audit record before it reaches Meta, then stamps the outcome after. Pauses, budget edits, new campaigns, automated rules firing. When a client asks why a campaign paused on the 14th, the answer is a query rather than a memory test.",
  },
  {
    q: "Can our clients log in?",
    a: "Access is by invitation from your admin, with roles that limit what a login can reach. Plenty of agencies keep clients out of the app entirely and share only the reports. Both work.",
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
            For agencies &amp; in-house teams
          </p>
          <h1
            className="mt-4 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-ink-foreground sm:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            The account that quietly stopped spending
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
            Every agency has had one. A client whose campaigns ended, whose
            budget ran out, whose ads sat marked &quot;active&quot; for weeks
            delivering nothing, and nobody noticed until the review call.
            adsboys exists so that call does not happen again.
          </p>
          <div className="mt-8">
            <DemoCta label="Book an agency walkthrough" />
          </div>
        </div>
      </div>

      <Section label="Portfolio operations" title="Built for many accounts, not one">
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard title="One deck, every client">
            Campaigns, ad sets, ads, creatives and audiences across all
            connected accounts, with a client filter that follows you through
            the whole app. Bulk pause and budget changes span accounts in one
            action.
          </FeatureCard>
          <FeatureCard title="Alerts that reach a human">
            Daily scanning across every account for spend drops,
            disapprovals, audience overlap, and accounts where nothing can
            deliver at all. A campaign whose ad sets have all ended reads
            &quot;not delivering&quot; rather than a green &quot;active&quot;,
            which is the difference between spotting a dead account and
            trusting a dashboard that looks fine.
          </FeatureCard>
          <FeatureCard title="Client-ready reporting">
            Weekly narrative reports per account, generated from real numbers
            with plain-English explanation. Five minutes of editing instead of
            two hours of writing.
          </FeatureCard>
          <FeatureCard title="Briefs instead of build-outs">
            Describe a campaign and the copilot drafts it from that
            client&apos;s own account: their creatives, their audiences, their
            past performance. Budgets and Meta&apos;s structural rules are
            checked before you see it, so a junior brief cannot produce a
            launch that fails halfway through. You edit any field and approve.
          </FeatureCard>
          <FeatureCard title="A portfolio-wide playbook">
            Winning hooks and angles from every account you run, ranked by
            real ROAS and CPA, so a new client benefits from what you learned
            on the last twelve.
          </FeatureCard>
          <FeatureCard title="Guardrails on junior hands">
            Every change is confirmed, shown as the exact payload that will
            hit Meta, and logged before it goes. Budget rules pause runaway
            spend at your thresholds, with spend floors so nothing acts on
            noise.
          </FeatureCard>
          <FeatureCard title="Conversations, not just campaigns">
            The comments and DMs your clients&apos; ads produce get answered
            and qualified in the same platform, with a staffed inbox your team
            works from.
          </FeatureCard>
        </div>
        <p className="mt-8 text-[15px] text-muted">
          Evaluating against a chat tool? See{" "}
          <Link href="/manychat-alternative" className="font-medium text-accent hover:underline">
            how adsboys compares to ManyChat
          </Link>
          , or read about{" "}
          <Link href="/security" className="font-medium text-accent hover:underline">
            how client data is isolated and governed
          </Link>
          .
        </p>
      </Section>

      <Section label="How we engage" title="Managed, not another login to learn" tone="surface">
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted">
          We run the deployment for you. That means connecting your
          clients&apos; Meta assets with the smallest set of permissions you
          are comfortable granting, read-only to begin with if you prefer,
          then configuring alerts, rules and bot profiles with your team in an
          onboarding sprint. After that we stay on hand as Meta changes things
          underneath everyone. Your team runs the work. We run the platform.
        </p>
        <div className="mt-8">
          <DemoCta />
        </div>
      </Section>

      <Section label="FAQ" title="What agency owners ask">
        <Faq items={FAQ} />
      </Section>

      <SiteFooter />
    </>
  );
}
