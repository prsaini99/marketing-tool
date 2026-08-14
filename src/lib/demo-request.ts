/**
 * Validation and normalisation for an inbound demo request. Pure module.
 *
 * This is the only input in the product that arrives from an ANONYMOUS
 * caller, so it is the only place where "what if this is hostile" is the
 * default question rather than an afterthought. Everything is bounded,
 * trimmed, and returned as plain data for the caller to store.
 *
 * Pure so the rules can be tested without a database or a network, and so
 * the same checks could run in the browser for instant feedback without the
 * two copies drifting.
 */

/** Upper bounds. Generous for a human, hostile to anyone pasting a payload. */
export const LIMITS = {
  name: 120,
  email: 200,
  company: 160,
  monthlySpend: 60,
  message: 4000,
  attribution: 300,
} as const;

export interface DemoRequestInput {
  name?: unknown;
  email?: unknown;
  company?: unknown;
  monthlySpend?: unknown;
  message?: unknown;
  source?: unknown;
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
  referrer?: unknown;
  /**
   * Honeypot. A field hidden from humans by CSS but visible to naive bots,
   * which fill every input they find. Anything here means the submission is
   * automated.
   */
  website?: unknown;
}

export interface CleanDemoRequest {
  name: string;
  email: string;
  company: string | null;
  monthlySpend: string | null;
  message: string | null;
  source: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrer: string | null;
}

export type ValidationResult =
  | { ok: true; value: CleanDemoRequest }
  | { ok: false; error: string; field?: string }
  /**
   * Spam. Distinguished from an error so the caller can answer 200 and
   * discard: telling a bot it was detected just teaches whoever wrote it to
   * fill the honeypot next time.
   */
  | { ok: false; spam: true };

/**
 * Deliberately permissive email check.
 *
 * The exhaustive RFC-correct pattern rejects addresses that genuinely work
 * and is the classic way to lose a real lead to a regex. This confirms the
 * shape and nothing more; whether the mailbox exists is answered by sending
 * to it, not by parsing.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // Strip control characters: they serve no purpose in these fields and are
  // how someone smuggles line breaks into a value that gets logged.
  const clean = v.replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
  if (!clean) return null;
  return clean.slice(0, max);
}

export function validateDemoRequest(input: DemoRequestInput): ValidationResult {
  // Honeypot first. No point validating a bot's spelling.
  if (typeof input.website === "string" && input.website.trim() !== "") {
    return { ok: false, spam: true };
  }

  const name = str(input.name, LIMITS.name);
  if (!name) return { ok: false, error: "Please tell us your name.", field: "name" };

  const email = str(input.email, LIMITS.email);
  if (!email) {
    return { ok: false, error: "Please give us an email address.", field: "email" };
  }
  if (!EMAIL_SHAPE.test(email)) {
    return { ok: false, error: "That email address does not look right.", field: "email" };
  }

  return {
    ok: true,
    value: {
      name,
      email: email.toLowerCase(),
      company: str(input.company, LIMITS.company),
      monthlySpend: str(input.monthlySpend, LIMITS.monthlySpend),
      message: str(input.message, LIMITS.message),
      source: str(input.source, LIMITS.attribution),
      utmSource: str(input.utmSource, LIMITS.attribution),
      utmMedium: str(input.utmMedium, LIMITS.attribution),
      utmCampaign: str(input.utmCampaign, LIMITS.attribution),
      referrer: str(input.referrer, LIMITS.attribution),
    },
  };
}

/** Triage states, in the order a lead moves through them. */
export const DEMO_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "ARCHIVED"] as const;
export type DemoStatus = (typeof DEMO_STATUSES)[number];

export function isDemoStatus(v: unknown): v is DemoStatus {
  return typeof v === "string" && (DEMO_STATUSES as readonly string[]).includes(v);
}
