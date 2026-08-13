import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Marketing-site chrome: nav, footer, and the shared blocks the public
 * pages compose. Server components only. These pages exist to rank, so
 * they ship no client JS of their own.
 *
 * They use the same design system as the product (ink chrome, ember
 * accent, paper field, Bricolage display), so the demo a prospect books
 * looks like the site that brought them.
 *
 * Every CTA is "Book a demo", never "sign up". adsboys is sold as a
 * managed deployment, and these pages are written for the evaluation
 * moment rather than impulse conversion.
 */

export function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 p-3 gap-1" : "h-8 w-8 p-2 gap-[3px]";
  const bar = size === "lg" ? "w-1.5" : "w-1";
  return (
    <span
      className={`inline-flex items-end justify-center rounded-lg bg-glow/15 ${box}`}
    >
      <span className={`h-1/2 ${bar} rounded-full bg-glow/50`} />
      <span className={`h-full ${bar} rounded-full bg-glow`} />
      <span className={`h-3/4 ${bar} rounded-full bg-glow/75`} />
    </span>
  );
}

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-border bg-ink/90 backdrop-blur-md">
      <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <BrandMark />
          <span
            className="text-lg font-bold tracking-tight text-ink-foreground"
            style={{ fontFamily: "var(--font-display)" }}
          >
            adsboys
          </span>
        </Link>
        <div className="flex items-center gap-1 text-sm">
          <Link
            href="/instagram-dm-automation"
            className="hidden rounded-md px-3 py-2 text-ink-muted transition-colors hover:text-ink-foreground sm:block"
          >
            DM automation
          </Link>
          <Link
            href="/for-agencies"
            className="hidden rounded-md px-3 py-2 text-ink-muted transition-colors hover:text-ink-foreground md:block"
          >
            For agencies
          </Link>
          <Link
            href="/manychat-alternative"
            className="hidden rounded-md px-3 py-2 text-ink-muted transition-colors hover:text-ink-foreground md:block"
          >
            vs ManyChat
          </Link>
          <Link
            href="/security"
            className="hidden rounded-md px-3 py-2 text-ink-muted transition-colors hover:text-ink-foreground lg:block"
          >
            Security
          </Link>
          <Link
            href="/login"
            className="rounded-md px-3 py-2 text-ink-muted transition-colors hover:text-ink-foreground"
          >
            Sign in
          </Link>
          <Link
            href="/demo"
            className="ml-2 rounded-lg bg-accent px-4 py-2 font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
          >
            Book a demo
          </Link>
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="chrome-rail border-t border-ink-border">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:grid-cols-3">
        <div>
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <span
              className="text-lg font-bold text-ink-foreground"
              style={{ fontFamily: "var(--font-display)" }}
            >
              adsboys
            </span>
          </div>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-muted">
            One place to run Meta campaigns, learn what works from your own
            results, and answer the people those ads bring in.
          </p>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            Product
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            {[
              ["/instagram-dm-automation", "Instagram DM automation"],
              ["/facebook-page-automation", "Facebook Page automation"],
              ["/comment-to-dm", "Comment-to-DM"],
              ["/instagram-lead-generation", "Instagram lead generation"],
              ["/manychat-alternative", "ManyChat alternative"],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="text-ink-muted hover:text-ink-foreground">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            Company
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href="/for-agencies" className="text-ink-muted hover:text-ink-foreground">
                For agencies
              </Link>
            </li>
            <li>
              <Link href="/security" className="text-ink-muted hover:text-ink-foreground">
                Security &amp; governance
              </Link>
            </li>
            <li>
              <Link href="/demo" className="text-ink-muted hover:text-ink-foreground">
                Book a demo
              </Link>
            </li>
            <li>
              <Link href="/login" className="text-ink-muted hover:text-ink-foreground">
                Client sign in
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-ink-border">
        <p className="mx-auto w-full max-w-6xl px-5 py-5 text-xs text-ink-subtle">
          © {new Date().getFullYear()} adsboys. Built for agencies and
          in-house teams running Meta ads at scale.
        </p>
      </div>
    </footer>
  );
}

export function DemoCta({ label = "Book a demo" }: { label?: string }) {
  return (
    <Link
      href="/demo"
      className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-base font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
    >
      {label}
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

/** Paper-field content section with an optional label and display heading. */
export function Section({
  label,
  title,
  children,
  tone = "paper",
}: {
  label?: string;
  title: string;
  children: React.ReactNode;
  tone?: "paper" | "surface";
}) {
  return (
    <section className={tone === "surface" ? "bg-surface" : "bg-background"}>
      <div className="mx-auto w-full max-w-6xl px-5 py-16">
        {label && (
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            {label}
          </p>
        )}
        <h2
          className="mt-2 max-w-2xl text-3xl font-bold leading-tight tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h2>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

export function FeatureCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h3 className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)" }}>
        {title}
      </h3>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">{children}</p>
    </div>
  );
}

/** FAQ block mirroring the JSON-LD each page emits. The questions come
    from what people actually search, which serves readers and rankings
    at the same time. */
export function Faq({ items }: { items: Array<{ q: string; a: string }> }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((f) => (
        <div key={f.q} className="rounded-xl border border-border bg-surface p-6">
          <h3 className="text-base font-semibold">{f.q}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">{f.a}</p>
        </div>
      ))}
    </div>
  );
}

export function faqJsonLd(items: Array<{ q: string; a: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
