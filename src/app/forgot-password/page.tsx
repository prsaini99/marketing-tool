"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { BrandMark } from "@/components/marketing/brand-mark";

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);
  const [email, setEmail] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Mock — real flow will call Supabase Auth `resetPasswordForEmail`.
    setSubmitted(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        {/* Brand. This page sits on paper, so the mark inherits dark ink. */}
        <div className="mb-8 flex flex-col items-center gap-2.5">
          <BrandMark />
          <span
            className="text-lg font-bold tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            adsboys
          </span>
        </div>

        {/* Card */}
        <div className="rounded-lg border border-border bg-background p-6 shadow-sm">
          {submitted ? (
            <div className="text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent-subtle">
                <Mail className="h-5 w-5 text-accent" />
              </div>
              <h1 className="mt-3 text-base font-semibold tracking-tight">
                Check your email
              </h1>
              <p className="mt-1 text-sm text-muted">
                We&apos;ve sent a reset link to{" "}
                <span className="text-foreground">{email || "your email"}</span>
                . It may take a minute to arrive.
              </p>
              <button
                type="button"
                onClick={() => setSubmitted(false)}
                className="mt-4 text-xs text-muted hover:text-foreground"
              >
                Didn&apos;t get it? Resend
              </button>
            </div>
          ) : (
            <>
              <div className="mb-5">
                <h1 className="text-base font-semibold tracking-tight">
                  Reset your password
                </h1>
                <p className="mt-1 text-sm text-muted">
                  Enter your email and we&apos;ll send a link to reset it.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="email"
                    className="text-xs font-medium text-foreground"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@agency.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    suppressHydrationWarning
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>

                <button
                  type="submit"
                  className="mt-2 w-full rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover transition-colors"
                >
                  Send reset link
                </button>
              </form>
            </>
          )}
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
