/**
 * Setup guide — how to generate a Meta access token for this platform.
 *
 * Content lives inline as TSX so anyone can edit it without a CMS.
 * Screenshots live in `public/setup-guide/` as plain PNGs — to replace a
 * stale one, just overwrite the file (filename stays the same).
 *
 * Layout: each step renders immediately above its screenshot (if any) so
 * the reader doesn't have to scroll back-and-forth between instructions
 * and visuals.
 *
 * Meta drifts. To keep this honest:
 *   1. Bump LAST_UPDATED whenever a section is verified or revised.
 *   2. Every section links to Meta's authoritative doc as the fallback.
 *   3. Each screenshot has a descriptive alt + caption so a reader can
 *      tell when Meta has changed the screen.
 */

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpen, ExternalLink } from "lucide-react";
import { SetupGuideToc } from "@/components/setup-guide/toc";

const LAST_UPDATED = "May 16, 2026";

interface Step {
  text: string;
  note?: string;
  // Screenshot pinned to this step. Renders directly under it.
  screenshot?: {
    src: string;
    alt: string;
    caption?: string;
  };
}

interface Section {
  id: string;
  number: number;
  title: string;
  blurb: string;
  steps: Step[];
  metaDocs: Array<{
    label: string;
    href: string;
  }>;
  // Set to true while content is being written so users know it's not done.
  draft?: boolean;
}

const SECTIONS: Section[] = [
  {
    id: "business-manager",
    number: 1,
    title: "Create / open a Meta Business Manager",
    blurb:
      "Every Meta API access token attaches to a Business Manager (BM). If your agency already has one, skip to step 2. Otherwise, create one — it's free.",
    steps: [
      {
        text: "Open business.facebook.com in your browser. You'll land on the entry page below if you're not logged in. Click Create new account.",
        screenshot: {
          src: "/setup-guide/01-bm-landing.png",
          alt: "business.facebook.com landing page with Continue with Facebook, Continue with Instagram, and Create new account buttons",
          caption:
            "Entry point. New users click Create new account. If you're already logged in, Meta takes you straight to your existing BM home — skip to step 4.",
        },
      },
      {
        text: "Fill in Business name, your name, and a work email. Submit.",
        note:
          "That email is where Meta sends verification and admin notifications, so don't use a personal one.",
      },
      {
        text: "Open the verification link Meta emails you to activate the BM.",
      },
      {
        text: "After verification you'll land on the Meta Business Suite home. That's the dashboard you'll come back to whenever this guide says 'open business.facebook.com'.",
        screenshot: {
          src: "/setup-guide/02-bm-home.png",
          alt: "Meta Business Suite home dashboard showing the BM's name, cover photo, and Create Post / Create ad action buttons",
          caption:
            "What an active BM home looks like. If your screen matches this, you're ready for step 2.",
        },
      },
    ],
    metaDocs: [
      {
        label: "Meta: Create a Business Manager",
        href: "https://www.facebook.com/business/help/1710077379203657",
      },
    ],
  },
  {
    id: "developer-app",
    number: 2,
    title: "Create a Meta Developer App + attach to your BM",
    blurb:
      "The app is the 'application' that owns the API tokens. It must be linked to your Business Manager and configured for the Marketing API, otherwise the tokens it issues won't be allowed to manage ads.",
    steps: [
      {
        text: "Go to developers.facebook.com/apps. You'll see your existing apps (if any) and a green Create App button in the top right. Click it.",
        screenshot: {
          src: "/setup-guide/03-apps-dashboard.png",
          alt: "developers.facebook.com Apps page showing the list of existing apps with the Create App button in the top right",
          caption:
            "Starting point: developers.facebook.com/apps. Click Create App (top right) to open the wizard.",
        },
      },
      {
        text: "App details — fill in the App name (anything, e.g., your agency name + ' ads') and a contact email. Click Next.",
      },
      {
        text: "Use cases — pick the ones that match the permissions this platform needs. At minimum, Create & manage ads with Marketing API.",
        note:
          "Tick only what you actually need today. Each extra use case Meta later requires its own app-review effort. If a future feature on the platform needs more (e.g., Instagram Graph API, Pages API), come back here and add it then.",
        screenshot: {
          src: "/setup-guide/04-app-use-cases.png",
          alt: "Use cases step of the Create App wizard with multiple use cases checked",
          caption:
            "Pick the use cases that cover the permissions the platform needs — Marketing API is the must-have; others go on as features expand.",
        },
      },
      {
        text: "Business — pick your Business Manager from the list. The badge should say 'Business verification complete'. Click Next.",
        note:
          "If it doesn't say verification complete, finish Business Verification first under Business Settings → Security Center, then come back.",
        screenshot: {
          src: "/setup-guide/05-app-business.png",
          alt: "Business step of the Create App wizard asking which business portfolio to connect, with one option selected",
          caption:
            "Connect your verified Business Manager so the app's tokens are scoped to it.",
        },
      },
      {
        text: "Requirements — Meta shows the App Review permissions you'll eventually need. Click Next.",
      },
      {
        text: "Overview — review everything, then click Create. Meta drops you into the new app's dashboard.",
        screenshot: {
          src: "/setup-guide/06-app-overview.png",
          alt: "Overview step of the Create App wizard showing summary of app details, use cases, and business",
          caption:
            "Final review. Click Create — you'll land on the app dashboard.",
        },
      },
    ],
    metaDocs: [
      {
        label: "Meta: Register as a developer + create your first app",
        href: "https://developers.facebook.com/docs/development/register/",
      },
    ],
  },
  {
    id: "marketing-api",
    number: 3,
    title: "Verify the Marketing API use case is attached",
    blurb:
      "Meta's new dashboard doesn't list 'Marketing API' as a separate sidebar product anymore — everything lives under Use cases. Quick check that what you ticked in step 2 actually saved.",
    steps: [
      {
        text: "Open the app from your Apps list — you land on its Dashboard. Look at the main panel: each attached use case appears as a 'Customize the … use case' row. Make sure 'Customize the Create & manage ads with Marketing API use case' is one of them.",
        screenshot: {
          src: "/setup-guide/07-app-dashboard-use-cases.png",
          alt: "App dashboard showing the list of attached use cases including Create & manage ads with Marketing API",
          caption:
            "Verification view: each attached use case shows up as a 'Customize the …' row on the Dashboard. Marketing API is the one we need.",
        },
      },
      {
        text: "If the Marketing API row is missing, click '+ Add use cases' in the top-right and tick 'Create & manage ads with Marketing API'. Save and come back to the Dashboard.",
        note:
          "If extra use cases got ticked by accident (App ads, Threads, WhatsApp …), it's safe to remove them from the Use cases page — each one Meta later requires its own review effort.",
      },
    ],
    metaDocs: [
      {
        label: "Meta: Marketing API overview",
        href: "https://developers.facebook.com/docs/marketing-apis/overview",
      },
      {
        label: "Meta: App use cases & permissions",
        href: "https://developers.facebook.com/docs/permissions",
      },
    ],
  },
  {
    id: "advanced-access",
    number: 4,
    title: "Submit for Advanced Access (production only)",
    blurb:
      "Standard Access lets you manage only your own ad accounts at limited rate. To manage clients' accounts at production scale you need Advanced Access for the Marketing API permissions — which gates on Business Verification + an App Review submission. Skip this whole step while you're just testing internally; Standard Access is enough for that.",
    steps: [
      {
        text:
          "From your app's Dashboard → click 'Customize the Create & manage ads with Marketing API use case' → in the left rail of that page, choose 'Permissions and features'. You'll see a list of permissions (ads_management, ads_read, business_management, …) each with a status and an Actions dropdown.",
        screenshot: {
          src: "/setup-guide/08-use-case-permissions.png",
          alt: "Permissions and features list inside the Create & manage ads use case",
          caption:
            "Each permission's Actions dropdown is where you request advanced access. The Marketing API Access Tier row at the top controls overall rate-limit tier.",
        },
      },
      {
        text:
          "On each permission you need (at minimum ads_management, ads_read, business_management), open Actions → 'Request advanced access'. Meta will prompt you for a short use-case description and a screen-recording proving how your app uses the permission.",
        note:
          "Meta moves these buttons every few releases — the labels here may read 'Get advanced access' or 'Upgrade' instead. The location stays in the use case's Permissions tab.",
      },
      {
        text:
          "Advanced Access also requires Business Verification on your Business Portfolio. Path: Business Settings → Authorisations and verifications → Verify yourself or an organisation → Business portfolio tab → Start verification. Verification needs legal-name + address + tax-ID proof and can take several business days.",
        note:
          "Meta moves this page every few releases — it used to live in Security Centre. If the path here looks different, search for 'Business Verification' in Business Settings or check Meta's doc linked below.",
        screenshot: {
          src: "/setup-guide/09-business-verification.png",
          alt: "Authorisations and verifications page with 'Verify yourself or an organisation' panel open",
          caption:
            "Click 'Verify yourself or an organisation' → pick the Business portfolio tab (not Ad accounts) → Start verification.",
        },
      },
      {
        text:
          "Once Business Verification is approved AND each permission's App Review submission passes (5–10 business days each), the use case's Permissions tab will show 'Advanced access' on the rows you submitted. At that point your token has production scale.",
        note:
          "This step rots faster than any other in this guide — if the screen here looks unfamiliar, jump straight to Meta's docs linked below. They're the authoritative source.",
      },
    ],
    metaDocs: [
      {
        label: "Meta: Access Levels (Standard vs Advanced)",
        href: "https://developers.facebook.com/docs/marketing-api/access",
      },
      {
        label: "Meta: App Review",
        href: "https://developers.facebook.com/docs/app-review",
      },
      {
        label: "Meta: Business Verification",
        href: "https://www.facebook.com/business/help/2058515294227817",
      },
    ],
  },
  {
    id: "system-user",
    number: 5,
    title: "Create a System User in Business Manager",
    blurb:
      "System Users issue tokens that don't expire and don't depend on any human staying logged in. This is the right token type for an agency platform — humans leave, but the System User token keeps the platform running.",
    steps: [
      {
        text:
          "business.facebook.com → Business Settings → Users → System users. You'll see any existing System Users in this Business Portfolio. Click + Add (top right) to create a new one.",
        screenshot: {
          src: "/setup-guide/10-system-users-page.png",
          alt: "System users list in Business Settings with the Add button highlighted",
          caption:
            "Existing System Users are listed with their ID + role. Click + Add to make a new one.",
        },
      },
      {
        text:
          "Name it something obvious and pick role: Admin. The Admin role lets the System User manage every asset (ad account, Page, …) you later assign to it. Meta sometimes rejects certain reserved names — if your first pick is refused, try a different one.",
        note:
          "Don't reuse one System User across multiple unrelated platforms. One purpose-built System User per integration makes it easier to revoke access cleanly later.",
        screenshot: {
          src: "/setup-guide/11-add-system-user-modal.png",
          alt: "Create system user modal showing the name field and role dropdown",
          caption:
            "Name + Admin role. The token you'll generate in step 7 attaches to this System User.",
        },
      },
    ],
    metaDocs: [
      {
        label: "Meta: Create a system user",
        href: "https://www.facebook.com/business/help/503306463479099",
      },
    ],
  },
  {
    id: "assign-assets",
    number: 6,
    title: "Assign Ad Accounts and Pages to the System User",
    blurb:
      "The token only inherits powers over assets you explicitly grant. Each client ad account needs to be added; for ad creation you also need at least one Facebook Page. We recommend Full control on both so every Meta GET/POST endpoint the platform might call is available.",
    steps: [
      {
        text:
          "Business Settings → Users → System users → click the System User you created → click Assign assets at the bottom of the empty 'No assets assigned' state.",
        screenshot: {
          src: "/setup-guide/12-assign-assets-start.png",
          alt: "System Users page with the new user selected and Assign assets call-to-action visible",
          caption:
            "Pick the System User, then click Assign assets. The modal that opens lets you attach assets type-by-type.",
        },
      },
      {
        text:
          "Asset type defaults to Facebook Pages — tick the Page(s) your ads will run from. On the right, toggle Full control → Everything ON. Also tick Leads under Partial access (Meta gates it separately because it exposes PII, but our platform needs it for lead-gen objective campaigns).",
        note:
          "Don't tick the bottom 'Everything' toggle if you want the System User to never delete the Page itself. For an internal single-user tool the blast radius is acceptable, so we toggle it on.",
        screenshot: {
          src: "/setup-guide/13-assign-pages.png",
          alt: "Asset assignment modal with Facebook Pages selected and Full control toggled on",
          caption:
            "Facebook Pages → Stackbinary page ticked → Full control → Everything ON. Also turn Leads on so lead-gen objective campaigns work.",
        },
      },
      {
        text:
          "Switch the asset type to Ad accounts (left column). Tick every client ad account this platform should manage. On the right, toggle Full control → Manage ad accounts ON. Click Assign assets at the bottom of the modal to save.",
        note:
          "If your senior adds new client ad accounts later, come back here and tick them — the System User can't see anything it wasn't explicitly granted.",
        screenshot: {
          src: "/setup-guide/14-assign-ad-accounts.png",
          alt: "Asset assignment modal with Ad accounts selected and Full control (Manage ad accounts) toggled on",
          caption:
            "Ad accounts → every client account ticked → Full control → Manage ad accounts ON. Save with Assign assets.",
        },
      },
    ],
    metaDocs: [
      {
        label: "Meta: Assign assets to system users",
        href: "https://www.facebook.com/business/help/156417631006622",
      },
      {
        label: "Meta: System user permissions reference",
        href: "https://developers.facebook.com/docs/marketing-api/system-users/overview",
      },
    ],
  },
  {
    id: "generate-token",
    number: 7,
    title: "Generate the access token",
    blurb:
      "Tokens are issued per app, per System User. Before you can run the Generate Token wizard, link your System User to the app so Meta knows which permissions it's allowed to mint. This is the value you'll paste into our Connect a Meta business screen.",
    steps: [
      {
        text:
          "Business Settings → Accounts → Apps → click your app from the list (e.g., stackbinary ads) → click Assign people. Skipping this first will make the Generate Token wizard show 'No permissions available' with no way forward.",
        screenshot: {
          src: "/setup-guide/15-app-assign-people.png",
          alt: "App settings page with the agency app selected and the Assign people button visible",
          caption:
            "Open the app's People panel. Without this link, the Generate Token wizard will refuse to show any scopes.",
        },
      },
      {
        text:
          "In the modal, tick your System User from the list and toggle Manage app under Full control. Click Assign.",
        note:
          "Full control here is the role on the app itself — not on individual ad accounts. Asset-level permissions are still whatever you set in step 6.",
        screenshot: {
          src: "/setup-guide/16-app-add-system-user-modal.png",
          alt: "Add people modal with the System User checked and Manage app (Full control) toggled on",
          caption:
            "Tick the System User, toggle Manage app on under Full control, hit Assign.",
        },
      },
      {
        text:
          "Go back to Business Settings → Users → System users → click your user → click Generate token (top right).",
        screenshot: {
          src: "/setup-guide/17-generate-token-button.png",
          alt: "System Users page with a System User selected showing the Generate token button at the top right",
          caption:
            "Generate token sits at the top of the selected System User's panel.",
        },
      },
      {
        text: "Select app — pick the app you created in step 2 from the dropdown. Click Next.",
        screenshot: {
          src: "/setup-guide/18-token-select-app.png",
          alt: "Generate token wizard step 1 with the Select app dropdown open showing the agency's apps",
          caption: "Pick the app the token will attach to.",
        },
      },
      {
        text:
          "Set expiry — choose Never. Meta recommends 60 days but that's for human-driven flows. Our backend needs a token that doesn't break every two months.",
        screenshot: {
          src: "/setup-guide/19-token-set-expiry.png",
          alt: "Generate token wizard Set expiry step with Never radio selected",
          caption:
            "Never is the right call for backend automation. 60 days is fine for personal use.",
        },
      },
      {
        text:
          "Assign permissions — open the dropdown and tick at minimum: ads_management, business_management, pages_show_list, pages_manage_ads, pages_read_engagement. If you know you'll add catalog / Threads / WhatsApp features later, tick those too — easier to include now than to regenerate the token.",
        note:
          "The token's scope is exactly what's ticked here. Anything skipped today can't be unlocked tomorrow without revoking and generating a new token.",
        screenshot: {
          src: "/setup-guide/20-token-select-permissions.png",
          alt: "Assign permissions step with the permissions dropdown open showing the available scopes",
          caption:
            "Only the scopes your app's use cases expose appear here. If something you expect is missing, go back and customize the use case in step 3.",
        },
      },
      {
        text:
          "Meta may show an 'Almost finished — verify your account' gate. This is a security check that fires for sensitive token operations independent of how many permissions you picked. Click Verify account and complete the flow (phone OTP or photo ID). Skipping with Close still leaves the token usable for most calls, but some advanced operations will stay blocked until you verify.",
        screenshot: {
          src: "/setup-guide/21-verify-account-popup.png",
          alt: "Almost finished verify your account modal overlay during token generation",
          caption:
            "Identity verification gate. Independent of the permissions ticked — Meta sometimes triggers it for high-privilege tokens.",
        },
      },
      {
        text:
          "Copy the token from the Token created screen. Meta shows this value once and never again — keep it somewhere safe until you paste it into our Connect a Meta business screen (step 8 below).",
        note:
          "If the token is ever lost or exposed, come back here and click Revoke tokens → Generate token again. You'll then need to re-paste the new value into our platform for it to keep working.",
        screenshot: {
          src: "/setup-guide/22-token-created.png",
          alt: "Token created confirmation screen with the token string and a Copy button",
          caption:
            "Copy immediately. Meta does not show this string again — only a revoke + regenerate gets you a new one.",
        },
      },
    ],
    metaDocs: [
      {
        label: "Meta: System User access tokens",
        href: "https://developers.facebook.com/docs/marketing-api/system-users",
      },
      {
        label: "Meta: Permissions reference",
        href: "https://developers.facebook.com/docs/permissions",
      },
    ],
  },
  {
    id: "paste-into-platform",
    number: 8,
    title: "Paste the token into our platform",
    blurb:
      "Last step — the token is what unlocks the rest of the app for you.",
    steps: [
      {
        text:
          "Open Connect a Meta business in the sidebar (or visit /dashboard/connect-business).",
      },
      {
        text:
          "Paste the token, give it a label (e.g., your agency name), and click Discover.",
      },
      {
        text: "Pick which ad accounts under it to sync. Save. You're done.",
      },
    ],
    metaDocs: [],
  },
];

export default function SetupGuidePage() {
  const tocItems = SECTIONS.map((s) => ({
    id: s.id,
    number: s.number,
    title: s.title,
    draft: s.draft,
  }));
  return (
    <div className="mx-auto flex w-full max-w-6xl gap-8">
      {/* Main column */}
      <div className="min-w-0 max-w-3xl flex-1 space-y-6">
        {/* Header */}
        <header>
          <div className="flex items-center gap-2 text-xs text-muted">
            <BookOpen className="h-3.5 w-3.5" />
            <span>Setup guide</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            Getting a Meta access token
          </h1>
          <p className="mt-1 text-sm text-muted">
            End-to-end walkthrough — from creating a Meta Business Manager to
            pasting a System User token into this app. Meta&apos;s screens
            change every few months; each section links to their official docs
            as the fallback if a screenshot here looks different from yours.
          </p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] text-subtle">
            <span className="font-medium text-foreground">Last updated:</span>
            <span>{LAST_UPDATED}</span>
          </div>
        </header>

        {/* Mobile-only inline TOC — the sticky right rail is hidden below lg. */}
        <nav className="rounded-lg border border-border bg-surface px-4 py-3 lg:hidden">
          <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">
            On this page
          </div>
          <ol className="mt-2 space-y-0.5 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <Link
                  href={`#${s.id}`}
                  className="flex items-center gap-1.5 text-muted hover:text-foreground"
                >
                  <span className="w-5 text-right tabular-nums text-subtle">
                    {s.number}.
                  </span>
                  <span>{s.title}</span>
                  {s.draft && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      Coming soon
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        {/* Sections */}
      {SECTIONS.map((s) => (
        <section
          key={s.id}
          id={s.id}
          className="scroll-mt-20 rounded-lg border border-border bg-background"
        >
          <div className="border-b border-border px-5 py-3">
            <div className="flex items-baseline gap-3">
              <span className="text-xs font-medium text-subtle">
                Step {s.number}
              </span>
              {s.draft && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  Draft — screenshots pending
                </span>
              )}
            </div>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight">
              {s.title}
            </h2>
            <p className="mt-1 text-sm text-muted">{s.blurb}</p>
          </div>

          <div className="space-y-5 px-5 py-4">
            <ol className="space-y-5">
              {s.steps.map((step, i) => (
                <li key={i} className="space-y-2">
                  <div className="flex gap-3 text-sm">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-medium text-foreground">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-foreground">{step.text}</p>
                      {step.note && (
                        <p className="mt-1 text-xs text-muted">{step.note}</p>
                      )}
                    </div>
                  </div>
                  {step.screenshot && (
                    <figure className="ml-8 overflow-hidden rounded-md border border-border bg-surface">
                      <div className="relative h-auto w-full">
                        <Image
                          src={step.screenshot.src}
                          alt={step.screenshot.alt}
                          width={1280}
                          height={720}
                          className="h-auto w-full object-contain"
                        />
                      </div>
                      {step.screenshot.caption && (
                        <figcaption className="border-t border-border px-3 py-1.5 text-[11px] text-muted">
                          {step.screenshot.caption}
                        </figcaption>
                      )}
                    </figure>
                  )}
                </li>
              ))}
            </ol>

            {s.metaDocs.length > 0 && (
              <div className="rounded-md border border-dashed border-border bg-surface px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">
                  Authoritative reference
                </div>
                <ul className="mt-1 space-y-0.5">
                  {s.metaDocs.map((d) => (
                    <li key={d.href}>
                      <a
                        href={d.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
                      >
                        {d.label}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-subtle">
                  If a screen here doesn&apos;t match what you see, Meta&apos;s
                  doc is the source of truth.
                </p>
              </div>
            )}
          </div>
        </section>
      ))}

        {/* Wrap-up */}
        <section className="rounded-lg border border-border bg-surface px-5 py-4">
          <h3 className="text-sm font-semibold tracking-tight">All set?</h3>
          <p className="mt-1 text-sm text-muted">
            Head to{" "}
            <Link
              href="/dashboard/connect-business"
              className="inline-flex items-center gap-0.5 text-foreground hover:underline"
            >
              Connect a Meta business
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>{" "}
            and paste your token.
          </p>
        </section>
      </div>

      {/* Sticky right-rail TOC, Notion-style. Hidden on mobile — the inline
          version up top handles small screens. */}
      <SetupGuideToc items={tocItems} />
    </div>
  );
}
