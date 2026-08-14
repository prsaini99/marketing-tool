/**
 * GA4, Microsoft Clarity and Search Console verification.
 *
 * INERT UNTIL CONFIGURED. Each tag renders only when its id is present, so a
 * deployment without the env vars ships no third-party script at all. That
 * matters more than it sounds: a half-configured analytics tag is a script
 * you are paying for in load time and CSP surface while collecting nothing.
 *
 * MARKETING PAGES ONLY. This is mounted on the public site, never on
 * /dashboard. Session-recording a logged-in ad account would put client
 * campaign names, budgets and customer conversations into Clarity's
 * recordings, which is a data-handling promise this product does not make
 * and would contradict the security page.
 *
 * PRODUCTION ONLY. Local development would otherwise pollute the numbers
 * from the day the tag lands, and the first weeks of data on a new site are
 * the ones you actually read.
 *
 * NEXT_PUBLIC_ is correct here despite the usual caution: these ids are
 * public by construction. They appear in the page source of every site that
 * uses them, and Google and Microsoft both treat them as identifiers rather
 * than secrets.
 */

import Script from "next/script";

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;

export function isAnalyticsEnabled(): boolean {
  return process.env.NODE_ENV === "production";
}

export function Analytics() {
  if (!isAnalyticsEnabled()) return null;

  return (
    <>
      {GA_ID && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_ID}', {
                // The demo page is noindex and its URL carries nothing
                // sensitive, but anonymising IPs is the default worth having
                // on a site whose own privacy policy promises restraint.
                anonymize_ip: true
              });
            `}
          </Script>
        </>
      )}

      {CLARITY_ID && (
        <Script id="clarity-init" strategy="afterInteractive">
          {`
            (function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "${CLARITY_ID}");
          `}
        </Script>
      )}
    </>
  );
}

/**
 * Search Console ownership, as a meta tag.
 *
 * The HTML-tag method is used rather than the DNS TXT record because it
 * belongs in the repo: whoever redeploys the site keeps verification alive
 * without needing access to the registrar. Google keeps checking for this
 * tag after verification, so removing it later un-verifies the property.
 */
export function searchConsoleVerification(): Record<string, string> | undefined {
  const token = process.env.NEXT_PUBLIC_GSC_VERIFICATION;
  return token ? { "google-site-verification": token } : undefined;
}
