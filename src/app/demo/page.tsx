import type { Metadata } from "next";
import { CalendarCheck, Mail } from "lucide-react";
import { BrandMark, SiteFooter, SiteNav } from "@/components/marketing/site";

/**
 * Demo request, the single conversion point every page funnels to.
 *
 * Deliberately not a form. Enterprise buyers at this stage want a person,
 * and an unstaffed form is a leak. Email opens a real conversation with
 * useful context pre-filled. Swap in a Calendly or Cal.com embed here once a
 * booking link exists.
 */

export const metadata: Metadata = {
  title: "Book a Demo | adsboys",
  description:
    "See adsboys running on your own Meta account. Campaigns, AI creative analysis and conversation automation, walked through live in 30 minutes.",
  alternates: { canonical: "https://adsboys.com/demo" },
  robots: { index: false },
};

const MAILTO =
  "mailto:gursat@stackbinary.io?subject=" +
  encodeURIComponent("adsboys demo request") +
  "&body=" +
  encodeURIComponent(
    "Hi, I'd like a demo of adsboys.\n\nCompany:\nMonthly Meta ad spend (approx):\nWhat we most want to solve:\nGood times to talk:",
  );

export default function DemoPage() {
  return (
    <>
      <SiteNav />
      <div className="chrome-rail min-h-[70vh]">
        <div className="mx-auto w-full max-w-2xl px-5 pb-20 pt-16 text-center">
          <div className="flex justify-center">
            <BrandMark size="lg" />
          </div>
          <h1
            className="mt-6 text-4xl font-extrabold tracking-tight text-ink-foreground"
            style={{ fontFamily: "var(--font-display)" }}
          >
            See adsboys on your own account
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-ink-muted">
            Thirty minutes with the team, on your own data. Your campaigns in
            the command deck, the AI reading your creatives, and the
            conversation engine answering a live message. No slides.
          </p>

          <div className="mx-auto mt-10 max-w-md rounded-2xl border border-ink-border bg-background p-8 text-left shadow-modal">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CalendarCheck className="h-4 w-4 text-accent" />
              Request your demo
            </div>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              Email us and we&apos;ll reply within one business day with times.
              Mention your approximate monthly Meta spend so we bring the
              right examples.
            </p>
            <a
              href={MAILTO}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-base font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
            >
              <Mail className="h-4 w-4" />
              Email the team
            </a>
            <p className="mt-3 text-center text-xs text-subtle">
              gursat@stackbinary.io
            </p>
          </div>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
