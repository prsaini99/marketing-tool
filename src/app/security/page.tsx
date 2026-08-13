import type { Metadata } from "next";
import Link from "next/link";
import { Lock, ScrollText, ShieldCheck, SplitSquareVertical } from "lucide-react";
import {
  DemoCta,
  Faq,
  faqJsonLd,
  Section,
  SiteFooter,
  SiteNav,
} from "@/components/marketing/site";

/**
 * Security and governance, the page enterprise procurement asks for.
 *
 * EVERY CLAIM HERE IS A REAL, VERIFIABLE PROPERTY OF THE SYSTEM. No
 * certifications are implied, because we hold none yet: SOC 2, ISO and
 * penetration-test language are deliberately absent. For this buyer, a
 * specific true statement ("tokens are AES-256-GCM encrypted and decrypted
 * in exactly one module") beats a badge they cannot verify, and a page that
 * over-claims is the one that fails the security review it was written for.
 */

export const metadata: Metadata = {
  title: "Security and Governance | adsboys",
  description:
    "How adsboys protects client ad accounts: a dedicated deployment per client, encrypted credentials, audit-logged writes, confirmation on every change, and AI replies bounded by a hard output filter.",
  alternates: { canonical: "https://adsboys.com/security" },
};

const FAQ = [
  {
    q: "Where is our data stored, and is it shared with other clients?",
    a: "Each client gets a dedicated instance with its own database and its own Meta app. There is no shared multi-tenant datastore. Another client's data is not filtered out of your queries, it is in a different database entirely.",
  },
  {
    q: "How are our Meta access tokens protected?",
    a: "Tokens are encrypted at rest with AES-256-GCM using a key unique to your deployment, and decrypted inside the single module that makes the API call. Logs reference connection identifiers and never token values.",
  },
  {
    q: "What permissions does adsboys actually need?",
    a: "Only what the features you turn on require, and you grant it asset by asset in your own Business Manager. Read-only access to specific ad accounts is a perfectly good starting point. Messaging automation needs Page messaging permissions and nothing beyond them. Meta enforces these limits on its own servers, so the platform cannot exceed what you granted.",
  },
  {
    q: "Can we revoke access?",
    a: "At any time, on your own, from your Business Settings. Remove the asset assignment or the system user and access ends immediately. You never have to ask us to hand anything back.",
  },
  {
    q: "What stops the AI from saying something harmful to a customer?",
    a: "An output filter runs on every generated reply. Only links from your approved list and prices published word for word in your business profile are allowed through. A reply containing anything else is blocked before it sends. The check lives in code, so it holds no matter how the model was prompted.",
  },
  {
    q: "Do you hold SOC 2 or ISO 27001?",
    a: "Not today, and we would rather say so than imply otherwise. What we can evidence is the architecture on this page: deployment isolation, credential encryption, audit-logged writes and confirmation gates. We also run a security review with your team during onboarding.",
  },
];

const PILLARS = [
  {
    icon: SplitSquareVertical,
    title: "Isolation by deployment, not by query",
    body: "Every client runs on a dedicated instance with its own database, application, Meta app and credentials. Cross-client exposure is not prevented by a WHERE clause somebody could forget. The data lives in different places, so an incident affecting one client has no path to another.",
  },
  {
    icon: Lock,
    title: "Credentials encrypted, and rarely touched",
    body: "Meta access tokens are AES-256-GCM encrypted at rest with a key unique to your deployment. One module can decrypt them, and that same module is the only one allowed to call Meta, so credentials never spread through the codebase. Nothing logs a token, not even partially. Every database table has row-level security enabled on top of that, which blocks anonymous and API-layer access outright.",
  },
  {
    icon: ScrollText,
    title: "Every write is on the record before it happens",
    body: "Pauses, budget changes, new campaigns and automated rules all write an audit record before the request reaches Meta, then stamp the outcome afterwards. A call that fails still leaves a trace. Months later, 'why did this campaign pause on the 14th' is a query with an answer rather than a reconstruction.",
  },
  {
    icon: ShieldCheck,
    title: "Nothing moves money without a person, except what you authorised",
    body: "Every create, pause, budget change and delete asks for confirmation, shown next to the exact payload that will hit Meta. Automated rules are the one exception, and they arrive switched off. You preview each one against live data before enabling it, and spend floors, data-coverage checks and cooldowns keep them from acting on noise. No automated action can increase spend. That was a deliberate choice.",
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
            Security &amp; governance
          </p>
          <h1
            className="mt-4 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight text-ink-foreground sm:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            You are handing us access to ad spend. This is what protects it.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
            No badges and no vague assurances, just the checkable properties
            of how adsboys is built and delivered. Bring your security team to
            the call.
          </p>
          <div className="mt-8">
            <DemoCta label="Talk to us with your security team" />
          </div>
        </div>
      </div>

      <Section label="Four guarantees" title="How the platform is built">
        <div className="grid gap-4 md:grid-cols-2">
          {PILLARS.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.title} className="rounded-xl border border-border bg-surface p-6">
                <Icon className="h-5 w-5 text-accent" aria-hidden />
                <h3
                  className="mt-3 text-lg font-semibold"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {p.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{p.body}</p>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        label="Conversation safety"
        title="What the AI is structurally unable to do"
        tone="surface"
      >
        <div className="max-w-3xl space-y-4 text-[15px] leading-relaxed text-muted">
          <p>
            An AI answering customers in your name is a liability unless
            something bounds it. Here the bound is code rather than prompt
            wording. Every generated reply goes through an output filter
            before it can send. It may contain links you approved and prices
            that appear word for word in your business profile, and nothing
            else. A reply carrying an unfamiliar URL or an invented figure is
            discarded. How confident the model was does not enter into it.
          </p>
          <p>
            The same discipline governs contact. Automated replies stay inside
            Meta&apos;s messaging windows, a comment permits exactly one
            private message within seven days, daily caps per person prevent
            repeat contact, and an opt-out is permanent. Complaints and
            qualified leads both route to a staffed inbox, where a person
            takes over with one click.
          </p>
          <p>
            Before a rule speaks to a real customer you can dry-run it. The
            full engine runs against a made-up message with every outbound
            path stubbed, so you read the exact wording first. In that mode the
            sender is swapped out inside the engine itself rather than by
            convention, which means a preview cannot reach Meta even if the
            calling code is wrong.
          </p>
        </div>
      </Section>

      <Section label="Access" title="Permissions you grant, and can revoke">
        <div className="max-w-3xl space-y-4 text-[15px] leading-relaxed text-muted">
          <p>
            Access is granted asset by asset from your own Meta Business
            Manager: specific ad accounts, specific Pages, at the permission
            level you choose. Plenty of clients start read-only, which still
            gives them full dashboards, AI analysis and reporting while making
            writes technically impossible, then move to campaign control once
            the platform has earned it. Meta&apos;s servers enforce those
            limits rather than our application, so they hold regardless of what
            our code attempts.
          </p>
          <p>
            Revocation is just as one-sided. Remove the assignment in your
            Business Settings and access stops immediately, with nothing
            required from us. Logins to the platform itself are invitation-only
            from your admin, limited by role, and can carry an expiry date for
            contractors or reviewers who only need it for a while.
          </p>
          <p>
            Read more about{" "}
            <Link href="/for-agencies" className="font-medium text-accent hover:underline">
              how agencies run multiple client accounts
            </Link>{" "}
            under this model.
          </p>
        </div>
      </Section>

      <Section label="FAQ" title="What security reviews ask" tone="surface">
        <Faq items={FAQ} />
        <div className="mt-10">
          <DemoCta />
        </div>
      </Section>

      <SiteFooter />
    </>
  );
}
