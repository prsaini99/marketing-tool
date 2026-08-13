/**
 * Outbound email — the ONLY module that talks to the email vendor.
 *
 * Same discipline as src/lib/meta/: one module owns the vendor SDK, callers
 * pass normalized inputs and get a normalized result, so swapping Resend for
 * SES later is a one-file change rather than a grep-and-pray.
 *
 * TWO RULES, both learned from the Meta layer:
 *
 * 1. NEVER THROW. Delivery is a side effect of a cron job that has already
 *    done the expensive work (scanning accounts, calling the LLM, writing
 *    Alert rows). A vendor outage must not turn a successful scan into a 500
 *    that loses the scan. Every failure comes back as `{ok:false, error}` and
 *    the caller decides.
 *
 * 2. NEVER LOG THE BODY. Digests contain the client's spend and performance
 *    numbers. Logs reference the recipient count and the subject, never the
 *    content — mirroring the "never log tokens" rule in credentials.ts.
 *
 * Config (all optional — absent config disables sending rather than
 * crashing the app at import time, which is what makes local dev and the
 * demo instance work without an email vendor at all):
 *   RESEND_API_KEY  — enables sending; without it every send is a no-op
 *   EMAIL_FROM      — e.g. "Marketing Tool <alerts@yourdomain.com>"; must be
 *                     a domain verified in Resend or the vendor rejects it
 *   EMAIL_REPLY_TO  — optional
 */

import { Resend } from "resend";

export interface SendEmailInput {
  to: string[];
  subject: string;
  html: string;
  /** Plain-text fallback. Worth setting: some corporate clients strip HTML. */
  text?: string;
}

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string; disabled?: boolean };

const FROM_FALLBACK = "Marketing Tool <onboarding@resend.dev>";

/**
 * Lazily constructed. A module-level `new Resend(key)` would run at import
 * time — including during `next build`, where the key legitimately may not
 * exist — and the SDK throws on a missing key.
 */
let client: Resend | null = null;

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!client) client = new Resend(key);
  return client;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Basic shape check. Deliberately permissive — this is a guard against
 * obviously-broken input (empty strings, missing @) reaching the vendor and
 * failing the whole batch, not an attempt to validate deliverability, which
 * only sending can establish.
 */
export function isValidEmail(address: string): boolean {
  const a = address.trim();
  return a.length > 3 && a.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a);
}

export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const recipients = input.to.map((t) => t.trim()).filter(isValidEmail);
  if (recipients.length === 0) {
    return { ok: false, error: "No valid recipients" };
  }

  const resend = getClient();
  if (!resend) {
    // Not an error the operator needs to see in red — the demo instance and
    // local dev both run without email configured on purpose.
    console.info(
      `[email] skipped "${input.subject}" (${recipients.length} recipients): RESEND_API_KEY not set`,
    );
    return { ok: false, error: "Email is not configured", disabled: true };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || FROM_FALLBACK,
      to: recipients,
      subject: input.subject,
      html: input.html,
      ...(input.text ? { text: input.text } : {}),
      ...(process.env.EMAIL_REPLY_TO
        ? { replyTo: process.env.EMAIL_REPLY_TO }
        : {}),
    });

    if (error) {
      // Resend returns errors in-band rather than throwing.
      return { ok: false, error: error.message || "Email vendor rejected the send" };
    }
    console.info(
      `[email] sent "${input.subject}" to ${recipients.length} recipient(s)`,
    );
    return { ok: true, id: data?.id ?? null };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown email error",
    };
  }
}
