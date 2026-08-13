import type { NextConfig } from "next";

/**
 * Security response headers, applied to every route.
 *
 * Deliberately NOT a full Content-Security-Policy. A real script-src policy
 * on an App Router app needs per-request nonces threaded through the inline
 * bootstrap script, and getting it wrong breaks hydration silently in
 * production. The headers below are the ones that are unambiguous wins with
 * no such risk. Revisit a full CSP when the analytics tags land, since
 * Clarity and GA4 both inject third-party script and would each need an
 * explicit allowance anyway.
 *
 * frame-ancestors is expressed twice on purpose: X-Frame-Options for older
 * agents, and the CSP directive that supersedes it for current ones. Both say
 * the same thing, which is that nothing may frame this app. The dashboard
 * carries one-click destructive controls (pause campaign, delete connection),
 * so clickjacking is the attack that actually matters here.
 */
const securityHeaders = [
  {
    // Two years, subdomains included. No `preload` token: browser preload
    // lists are slow to enter and slower to leave, and committing every
    // future adsboys.com subdomain to HTTPS-only before any exist is a
    // promise worth making deliberately rather than by default.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send the full URL only to ourselves. Cross-origin gets the bare origin,
  // which keeps account and campaign ids in dashboard paths out of the
  // Referer header on any outbound link.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
