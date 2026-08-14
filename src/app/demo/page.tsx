import type { Metadata } from "next";
import { BrandMark, SiteFooter, SiteNav } from "@/components/marketing/site";
import { DemoForm } from "@/components/marketing/demo-form";
import { OPERATOR } from "@/components/marketing/legal";

/**
 * Demo request, the single conversion point every page funnels to.
 *
 * The address comes from OPERATOR rather than a literal, so the contact
 * address on the legal pages and the one on the conversion page can never
 * drift apart. They already had once.
 */

export const metadata: Metadata = {
  title: "Book a Demo | adsboys",
  description:
    "See adsboys running on your own Meta account. Campaigns, AI creative analysis and conversation automation, walked through live in 30 minutes.",
  alternates: { canonical: "https://adsboys.com/demo" },
  robots: { index: false },
};

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

          <div className="mx-auto mt-10 max-w-xl">
            <DemoForm contactEmail={OPERATOR.contactEmail} />
          </div>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
