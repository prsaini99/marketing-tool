import type { Metadata } from "next";
import Link from "next/link";
import {
  Clause,
  LegalNav,
  LegalPage,
  OPERATOR,
  Points,
} from "@/components/marketing/legal";

/**
 * Terms of service. Meta's App Dashboard has a field for this and reviewers
 * check that it resolves, but its real audience is the enterprise buyer's
 * procurement team.
 *
 * Written to describe the actual engagement model: a managed deployment sold
 * per client, not a self-serve subscription. Anything about pricing, notice
 * periods or liability caps is left to the signed agreement rather than
 * invented here, because a public page that contradicts the contract is worse
 * than a public page that defers to it.
 */

export const metadata: Metadata = {
  title: "Terms of Service | adsboys",
  description:
    "The terms covering use of adsboys, including acceptable use of the Meta automation features and where the signed agreement takes precedence.",
  alternates: { canonical: "https://adsboys.com/terms" },
};

export default function Page() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of service"
      intro={`The terms under which ${OPERATOR.legalName} provides ${OPERATOR.product}.`}
    >
      <LegalNav current="terms" />

      <div className="mt-10">
        <Clause n={1} title="These terms, and your agreement">
          <p>
            {OPERATOR.product} is provided by <strong>{OPERATOR.legalName}</strong>{" "}
            as a managed deployment, set up and operated for each client rather
            than sold as self-serve software.
          </p>
          <p>
            Commercial terms live in the agreement you signed with us: scope,
            fees, term, notice, service levels and liability. Where that
            agreement says something different from this page,{" "}
            <strong>the signed agreement wins</strong>. This page covers the
            things that apply to anyone using the platform.
          </p>
        </Clause>

        <Clause n={2} title="What we provide">
          <Points
            items={[
              "A deployment of the platform connected to the Meta assets you assign to it.",
              "Configuration of alerts, automation rules and the business profile with your team during onboarding.",
              "Ongoing operation of the platform, including keeping it working as Meta changes its APIs.",
            ]}
          />
          <p>
            We do not control Meta. Meta deprecates API versions, changes
            permissions and reviews apps on its own schedule, and some
            functionality depends on approvals only Meta can grant.
          </p>
        </Clause>

        <Clause n={3} title="Your account and your Meta assets">
          <Points
            items={[
              "You grant access asset by asset from your own Meta Business Manager, and you can revoke it at any time without asking us.",
              "You are responsible for keeping login credentials confidential and for what is done through logins you issue.",
              "You confirm you are authorised to connect the Meta assets you connect, and to let us act on them on your behalf.",
              "You remain responsible for the ad spend on your accounts, including spend affected by automation rules you enable.",
            ]}
          />
        </Clause>

        <Clause n={4} title="Acceptable use of the messaging features">
          <p>
            The automation features send messages in your name to real people,
            under Meta&apos;s policies. Using them in the following ways is not
            permitted, and we will disable the feature if we become aware of
            it.
          </p>
          <Points
            items={[
              "Messaging people who have not contacted you first, or attempting to work around the comment and messaging windows.",
              "Continuing to message someone who has opted out.",
              "Removing or obscuring the notice that tells a person they are talking to an automated assistant.",
              "Configuring the business profile so the automated replies make claims you know to be untrue, including prices or offers you do not honour.",
              "Sending content that is unlawful, deceptive, harassing, or that Meta's platform policies prohibit.",
              "Using the platform to collect personal data for a purpose the person would not reasonably expect from the conversation they started.",
            ]}
          />
          <p>
            The platform enforces the messaging windows, the daily caps, the
            permanent opt-out and the reply safety filter in code. Those are
            floors rather than a substitute for using the feature responsibly.
          </p>
        </Clause>

        <Clause n={5} title="AI-generated output">
          <p>
            Parts of the platform generate text and images: suggested ad copy,
            written performance analysis, and replies to customers. Generated
            output is grounded in your own data and your approved business
            profile, and replies pass a filter that blocks links outside your
            approved list and prices absent from your published profile.
          </p>
          <p>
            It is still generated output. Review anything before you publish it
            as an ad, and treat automated analysis as a starting point for a
            decision rather than the decision. You remain responsible for what
            goes out under your brand.
          </p>
        </Clause>

        <Clause n={6} title="Data">
          <p>
            How data is handled is set out in the{" "}
            <Link href="/privacy">privacy policy</Link>, and deletion is covered
            on the{" "}
            <Link href="/data-deletion">data deletion page</Link>. In short: for
            the personal data of people who contact you, you are the controller
            and we act on your instructions.
          </p>
          <p>
            You are responsible for having whatever notice or consent your own
            customers are owed where you operate.
          </p>
        </Clause>

        <Clause n={7} title="Availability">
          <p>
            We aim for the platform to be available and correct, and we will
            tell you when it is not. Any committed service level is the one in
            your signed agreement.
          </p>
          <p>
            The platform depends on Meta, on our hosting and database
            providers, and on an AI vendor. An outage at any of those can
            interrupt the service, and syncing may lag while a provider is
            degraded.
          </p>
        </Clause>

        <Clause n={8} title="Ending the engagement">
          <p>
            Notice periods and any refund terms are in your signed agreement.
            Regardless of what it says, you may cut off our access to your Meta
            assets yourself at any time from your Business Settings.
          </p>
          <p>
            On termination we delete your deployment and the data in it, or
            hand you an export first if you ask before the deletion runs.
          </p>
        </Clause>

        <Clause n={9} title="Contact">
          <p>
            {OPERATOR.legalName}, {OPERATOR.address}. Questions about these
            terms go to{" "}
            <a href={`mailto:${OPERATOR.contactEmail}`}>{OPERATOR.contactEmail}</a>.
          </p>
        </Clause>
      </div>
    </LegalPage>
  );
}
