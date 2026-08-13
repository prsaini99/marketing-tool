import type { Metadata } from "next";
import Link from "next/link";
import {
  Clause,
  LegalNav,
  LegalPage,
  LegalTable,
  OPERATOR,
  Points,
} from "@/components/marketing/legal";

/**
 * Privacy policy. Required by Meta App Review, and the URL a reviewer opens
 * first: a policy that 404s or does not mention the data the permissions
 * actually return gets a submission rejected before anything else is read.
 *
 * EVERY STATEMENT HERE DESCRIBES WHAT THE CODE DOES. The processor list is
 * the real dependency list, the messaging windows are the ones enforced in
 * decide.ts, and the retention clause says data is kept until deletion
 * because no scheduled purge job exists. If that changes, change this page in
 * the same commit. A policy that overstates is worse than none, because it is
 * the document you get held to.
 */

export const metadata: Metadata = {
  title: "Privacy Policy | adsboys",
  description:
    "What data adsboys receives from Meta, who processes it, how long it is kept, and how to have it deleted.",
  alternates: { canonical: "https://adsboys.com/privacy" },
};

export default function Page() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy policy"
      intro={`How ${OPERATOR.product} handles the data it receives from Meta and from the businesses that use it.`}
    >
      <LegalNav current="privacy" />

      <div className="mt-10">
        <Clause n={1} title="Who we are, and which role we play">
          <p>
            {OPERATOR.product} is operated by <strong>{OPERATOR.legalName}</strong>,
            located in {OPERATOR.country}. You can reach us at{" "}
            <a href={`mailto:${OPERATOR.contactEmail}`}>{OPERATOR.contactEmail}</a>.
          </p>
          <p>
            We act in two different roles, and it matters which one applies to
            you.
          </p>
          <Points
            items={[
              <>
                <strong>For the businesses that use {OPERATOR.product}</strong>,
                we are the controller of their account information and the
                operator of the platform they connect their Meta assets to.
              </>,
              <>
                <strong>
                  For the people who comment on or message those businesses
                </strong>
                , we are a processor. The business you contacted decides why
                your message is handled and for how long. We handle it on their
                instructions. If you want your data removed, you may contact
                either that business or us directly, and the{" "}
                <Link href="/data-deletion">data deletion page</Link> explains
                how.
              </>,
            ]}
          />
        </Clause>

        <Clause n={2} title="What we receive from Meta">
          <p>
            Access is granted asset by asset by the business, from their own
            Meta Business Manager. We only receive data for the ad accounts and
            Pages they explicitly assign.
          </p>
          <LegalTable
            head={["Category", "What it includes"]}
            rows={[
              [
                "Advertising data",
                "Ad accounts, campaigns, ad sets, ads, creatives, images, videos, saved audiences and conversion events, together with their performance metrics. This is business data and does not identify individual people.",
              ],
              [
                "Public comments",
                "The text of a comment on a connected Page or Instagram account, the commenter's Meta-scoped user id, their username, and the id of the post or ad it was left on.",
              ],
              [
                "Private messages",
                "The text of messages exchanged with a connected Page or Instagram account, and the sender's Meta-scoped user id.",
              ],
              [
                "Details you tell the business",
                "If you mention a name, company, requirement, budget, timeline, email address or phone number while talking to an automated assistant, that detail is saved against your conversation so the business does not ask you for it twice.",
              ],
              [
                "Access tokens",
                "The Meta access token the business granted, encrypted at rest.",
              ],
            ]}
          />
          <p>
            The Meta-scoped user id is not your real identity. Meta issues a
            different id for every business you interact with, so it cannot be
            used to recognise you anywhere else.
          </p>
          <p>
            We do not buy data, we do not scrape profiles, and we do not build
            a record of anyone who has not actually contacted a connected
            business.
          </p>
        </Clause>

        <Clause n={3} title="Why we use it">
          <Points
            items={[
              "To show a business its own advertising performance, and to generate reports, audits and creative analysis from it.",
              "To reply to comments and messages on that business's behalf, using rules and a business profile they configured.",
              "To pass a conversation to a human on that business's team when someone complains, asks for a person, or becomes a qualified enquiry.",
              "To keep an audit record of every change made through the platform, which is what lets a business answer why something happened on a given date.",
              "To email the business operational alerts about their own ad accounts.",
            ]}
          />
          <p>
            We do not use message content for advertising targeting, we do not
            sell it, and we do not use it to train our own models.
          </p>
        </Clause>

        <Clause n={4} title="Who else processes it">
          <p>
            We use a small number of service providers. Each one processes data
            only to provide its service to us.
          </p>
          <LegalTable
            head={["Provider", "What it does and what it sees"]}
            rows={[
              [
                "Vercel",
                "Hosts the application. All requests pass through it. Server functions run in Meta's Mumbai region.",
              ],
              [
                "Supabase",
                "Provides the Postgres database where advertising data, conversations and encrypted tokens are stored. Hosted in Mumbai.",
              ],
              [
                "OpenAI",
                "Generates suggested replies, ad copy and written analysis, and transcribes the audio of video ads. Comment and message text is sent to OpenAI to produce a reply. Inputs are not used to train OpenAI's models.",
              ],
              [
                "Resend",
                "Delivers operational email to the business, such as alert digests and weekly performance reports. These contain advertising metrics, not the content of conversations.",
              ],
            ]}
          />
        </Clause>

        <Clause n={5} title="Limits we enforce on automated messaging">
          <p>
            These are enforced in code rather than left to configuration, so
            they hold regardless of how a business sets up its rules.
          </p>
          <Points
            items={[
              "A comment permits exactly one private message, sent within seven days of that comment. A message that would fall outside the window is not sent.",
              "Automated replies in an existing conversation stay inside the standard 24-hour window from your last message.",
              "There are daily caps on how many automated messages one person can receive.",
              "Replying STOP opts you out permanently for that business. The opt-out cannot be undone by us, by the business, or by contacting the account again.",
              "The first automated private message you receive tells you that you are talking to an automated assistant and how to reach a person.",
              "Generated replies pass a filter that blocks any link outside the business's approved list and any price not published in their own profile, before the message is sent.",
            ]}
          />
        </Clause>

        <Clause n={6} title="How it is protected">
          <Points
            items={[
              "Each client runs as a dedicated deployment with its own database and its own Meta app. There is no shared multi-tenant datastore.",
              "Meta access tokens are encrypted at rest with AES-256-GCM using a key unique to that deployment, and are decrypted only inside the single module that calls Meta. Tokens are never written to logs.",
              "Database tables have row-level security enabled, which blocks anonymous and API-layer access.",
              "Incoming webhooks from Meta are verified by HMAC signature and rejected if the signature does not match.",
              "Access to the platform is invitation-only and limited by role.",
            ]}
          />
          <p>
            We hold no security certifications today, and we would rather say
            so than imply otherwise. The{" "}
            <Link href="/security">security page</Link> describes the
            architecture in more detail.
          </p>
        </Clause>

        <Clause n={7} title="How long we keep it">
          <p>
            Advertising data and conversation history are kept for as long as
            the business keeps its Meta assets connected, because the platform
            is a working record of their account rather than a temporary cache.
            There is no automatic expiry.
          </p>
          <p>
            When a business disconnects a Meta connection, everything beneath
            it is deleted: businesses, ad accounts, campaigns, ads, insights,
            creative analysis, conversations, leads and audit records. That
            deletion is immediate and cannot be undone.
          </p>
          <p>
            Individual deletion requests are handled as described on the{" "}
            <Link href="/data-deletion">data deletion page</Link>.
          </p>
        </Clause>

        <Clause n={8} title="Your choices">
          <Points
            items={[
              "Stop automated messages from a business by replying STOP in that conversation.",
              "Ask for a human at any point and the conversation is flagged to that business's team.",
              "Request a copy of what we hold about you, or ask for it to be deleted, by emailing us.",
              "A business can revoke our access to their Meta assets at any time from their own Business Settings, without asking us.",
            ]}
          />
          <p>
            Depending on where you live you may also have rights to correct
            data, object to processing, or complain to a data protection
            authority. Write to us and we will help.
          </p>
        </Clause>

        <Clause n={9} title="Changes">
          <p>
            If we change how data is handled, we update this page and the date
            at the top. Material changes are communicated to connected
            businesses directly rather than only being posted here.
          </p>
          <p>
            Questions about any of this go to{" "}
            <a href={`mailto:${OPERATOR.contactEmail}`}>{OPERATOR.contactEmail}</a>.
          </p>
        </Clause>
      </div>
    </LegalPage>
  );
}
