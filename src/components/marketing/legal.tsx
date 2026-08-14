import Link from "next/link";
import { SiteFooter, SiteNav } from "./site";

/**
 * Shared chrome and copy constants for the three legal pages.
 *
 * ONE PLACE TO EDIT. The operator details below are used across the privacy
 * policy, the terms, and the data deletion instructions, and Meta App Review
 * cross-checks the legal entity named here against the one on your Business
 * Verification. A mismatch between the two is a standard rejection reason, so
 * these must be the exact registered values, not trading names.
 */
export const OPERATOR = {
  /**
   * REPLACE with the full registered company name, exactly as it appears on
   * your incorporation certificate and on Meta Business Verification.
   * "StackBinary" is the trading name visible in the Meta Business Manager
   * and on the team's email domain; the registered entity is very likely
   * longer than that.
   */
  legalName: "StackBinary",
  /** Trading name used in running prose. */
  product: "adsboys",
  /** REPLACE with the registered office address. */
  address: "India",
  country: "India",
  contactEmail: "gursat@stackbinary.io",
  /**
   * Date these documents last changed in substance. Update it when you edit
   * them, since a policy with a stale date reads as unmaintained.
   */
  lastUpdated: "14 August 2026",
} as const;

/** Page shell: hero, then prose sections, then the standard footer. */
export function LegalPage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteNav />
      <div className="chrome-rail">
        <div className="mx-auto w-full max-w-3xl px-5 pb-14 pt-14">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-glow">
            {eyebrow}
          </p>
          <h1
            className="mt-4 text-4xl font-extrabold leading-[1.1] tracking-tight text-ink-foreground"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {title}
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-ink-muted">{intro}</p>
          <p className="mt-5 text-sm text-ink-subtle">
            Last updated {OPERATOR.lastUpdated}
          </p>
        </div>
      </div>
      <div className="bg-background">
        <div className="mx-auto w-full max-w-3xl px-5 py-14">{children}</div>
      </div>
      <SiteFooter />
    </>
  );
}

/** A numbered top-level clause. */
export function Clause({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-11 scroll-mt-24" id={`clause-${n}`}>
      <h2
        className="text-xl font-bold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        <span className="mr-2 text-accent" style={{ fontFamily: "var(--font-mono)" }}>
          {String(n).padStart(2, "0")}
        </span>
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-muted [&_a]:font-medium [&_a]:text-accent [&_a:hover]:underline [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

/** Bulleted list with the spacing the clause body expects. */
export function Points({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="ml-5 list-disc space-y-2">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** Two-column table used for the processor and data-category listings. */
export function LegalTable({
  head,
  rows,
}: {
  head: [string, string];
  rows: Array<[React.ReactNode, React.ReactNode]>;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[520px] text-[15px]">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
              {head[0]}
            </th>
            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
              {head[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              <td className="px-5 py-3.5 align-top font-medium text-foreground">
                {row[0]}
              </td>
              <td className="px-5 py-3.5 align-top text-muted">{row[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Cross-links between the three legal documents. */
export function LegalNav({ current }: { current: "privacy" | "terms" | "deletion" }) {
  const links: Array<[string, string, "privacy" | "terms" | "deletion"]> = [
    ["/privacy", "Privacy policy", "privacy"],
    ["/terms", "Terms of service", "terms"],
    ["/data-deletion", "Data deletion", "deletion"],
  ];
  return (
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {links.map(([href, label, key]) =>
        key === current ? (
          <span key={href} className="font-semibold text-foreground">
            {label}
          </span>
        ) : (
          <Link key={href} href={href} className="text-accent hover:underline">
            {label}
          </Link>
        ),
      )}
    </div>
  );
}
