"use client";

/**
 * The demo request form.
 *
 * Replaces a mailto: link, which was costing more than it looked. A mailto
 * hands the visitor off to a mail client that may not be configured, loses
 * everyone who is not at their own desk, and is invisible to analytics: the
 * click looks identical to leaving the site, so the funnel ended at "someone
 * viewed the demo page" with no way to know whether it worked.
 *
 * Attribution is captured at submit, from the URL and the referrer, because
 * both are gone the moment the tab closes. Knowing a lead came from the
 * ManyChat comparison page rather than a paid click is the difference
 * between the SEO work being justified and being a guess.
 *
 * The email address stays on the page underneath. Some people simply prefer
 * to write an email, and the form should not be the only door.
 */

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Mail, Send } from "lucide-react";

const SPEND_BANDS = [
  "Under 1 lakh a month",
  "1 to 5 lakh a month",
  "5 to 20 lakh a month",
  "Over 20 lakh a month",
  "Not running ads yet",
];

/** GA4's recommended event for a lead. Fires only on a stored submission. */
function trackLead() {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    gtag?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
  };
  // Optional chaining throughout: analytics is production-only and absent in
  // development, and a missing tag must never break the submission the user
  // just made.
  w.gtag?.("event", "generate_lead", {
    event_category: "demo",
    event_label: "demo_form",
  });
  // Tags the Clarity session so recordings of people who converted can be
  // filtered from those who did not.
  w.clarity?.("set", "demo_request", "submitted");
}

export function DemoForm({ contactEmail }: { contactEmail: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setError(null);

    const form = new FormData(e.currentTarget);
    const params = new URLSearchParams(window.location.search);

    try {
      const res = await fetch("/api/public/demo-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          company: form.get("company"),
          monthlySpend: form.get("monthlySpend"),
          message: form.get("message"),
          website: form.get("website"), // honeypot
          source: window.location.pathname,
          utmSource: params.get("utm_source"),
          utmMedium: params.get("utm_medium"),
          utmCampaign: params.get("utm_campaign"),
          referrer: document.referrer || null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      trackLead();
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-success" aria-hidden />
        <h3
          className="mt-3 text-xl font-bold"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Got it.
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-muted">
          We reply within one business day with a few times. If it is urgent,
          email{" "}
          <a href={`mailto:${contactEmail}`} className="font-medium text-accent hover:underline">
            {contactEmail}
          </a>
          .
        </p>
      </div>
    );
  }

  const field =
    "mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[15px] outline-none focus:border-accent";
  const label =
    "block text-[13px] font-semibold uppercase tracking-wide text-subtle";

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-border bg-surface p-6 text-left"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Your name</span>
          <input name="name" required maxLength={120} className={field} autoComplete="name" />
        </label>
        <label className="block">
          <span className={label}>Work email</span>
          <input
            name="email"
            type="email"
            required
            maxLength={200}
            className={field}
            autoComplete="email"
          />
        </label>
        <label className="block">
          <span className={label}>Company</span>
          <input name="company" maxLength={160} className={field} autoComplete="organization" />
        </label>
        <label className="block">
          <span className={label}>Monthly ad spend</span>
          <select name="monthlySpend" className={field} defaultValue="">
            <option value="">Prefer not to say</option>
            {SPEND_BANDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-4 block">
        <span className={label}>What do you most want to solve?</span>
        <textarea
          name="message"
          rows={3}
          maxLength={4000}
          className={field}
          placeholder="The more specific, the more useful the call."
        />
      </label>

      {/*
        Honeypot. Hidden from people and assistive technology, visible to
        bots that fill every input they find. aria-hidden and tabIndex keep
        it out of the keyboard and screen-reader path, so it costs a real
        user nothing.
      */}
      <div className="absolute h-0 w-0 overflow-hidden" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-danger-subtle px-3 py-2 text-[14px] text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={state === "sending"}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-base font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {state === "sending" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Send className="h-4 w-4" aria-hidden />
        )}
        {state === "sending" ? "Sending" : "Request a demo"}
      </button>

      {/*
        The form collects personal data, so the policy governing it has to be
        reachable from the point of collection rather than only from the
        footer. Stated plainly instead of as a tick box: consent theatre on a
        two-field contact form protects nobody.
      */}
      <p className="mt-3 text-center text-[13px] leading-relaxed text-subtle">
        We use this to reply to you and nothing else. See our{" "}
        <Link href="/privacy" className="font-medium text-accent hover:underline">
          privacy policy
        </Link>
        .
      </p>

      <p className="mt-2 flex items-center justify-center gap-1.5 text-[13px] text-subtle">
        <Mail className="h-3.5 w-3.5" aria-hidden />
        Or email{" "}
        <a href={`mailto:${contactEmail}`} className="font-medium text-accent hover:underline">
          {contactEmail}
        </a>
      </p>
    </form>
  );
}
