import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";
import {
  Clause,
  LegalNav,
  LegalPage,
  OPERATOR,
  Points,
} from "@/components/marketing/legal";

/**
 * Data deletion instructions. This is the URL that goes in the "Data
 * Deletion Instructions URL" field on the Meta App Dashboard, which is
 * mandatory before a messaging permission can be submitted for review.
 *
 * Meta's requirement is specific: a person must be able to read this page and
 * understand how to get their data removed without needing an account, a
 * login, or a support ticket system. So the route is a plain email address,
 * stated in the first paragraph, with a response commitment attached.
 */

export const metadata: Metadata = {
  title: "Data Deletion Instructions | adsboys",
  description:
    "How to have your data deleted from adsboys, what gets removed, and how long it takes.",
  alternates: { canonical: "https://adsboys.com/data-deletion" },
};

const SUBJECT = encodeURIComponent("Data deletion request");
const BODY = encodeURIComponent(
  [
    "I would like my data deleted.",
    "",
    "The business I contacted (Instagram handle or Facebook Page):",
    "The account I messaged from (Instagram handle or Facebook name):",
    "Roughly when we spoke:",
    "",
    "You may reply to this address to confirm.",
  ].join("\n"),
);

export default function Page() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Data deletion instructions"
      intro="How to have everything we hold about you removed, what that covers, and how long it takes."
    >
      <LegalNav current="deletion" />

      <div className="mt-8 rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Mail className="h-4 w-4 text-accent" aria-hidden />
          Request deletion
        </div>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Email{" "}
          <a
            href={`mailto:${OPERATOR.contactEmail}?subject=${SUBJECT}&body=${BODY}`}
            className="font-medium text-accent hover:underline"
          >
            {OPERATOR.contactEmail}
          </a>{" "}
          with the subject &quot;Data deletion request&quot;. You do not need an
          account with us, and there is no form to fill in. We reply within one
          business day and complete the deletion within 30 days.
        </p>
      </div>

      <div className="mt-10">
        <Clause n={1} title="What to include">
          <p>
            We identify you by the conversation you had, so we need enough to
            find it:
          </p>
          <Points
            items={[
              "The business you contacted, as an Instagram handle or Facebook Page name.",
              "The account you messaged or commented from.",
              "Roughly when the conversation happened, if you remember.",
            ]}
          />
          <p>
            We will not ask you for identity documents, and you do not need to
            explain why.
          </p>
        </Clause>

        <Clause n={2} title="What gets deleted">
          <Points
            items={[
              "Every message and comment of yours that we stored.",
              "Your Meta-scoped user id and the username recorded alongside it.",
              "The conversation thread itself, and the automated replies sent to you.",
              "Any details captured from the conversation, such as a name, company, requirement, budget, timeline, email address or phone number.",
              "The raw webhook payloads that carried those events.",
            ]}
          />
          <p>
            Deletion is permanent. We do not keep a shadow copy, and the
            records are removed rather than marked hidden.
          </p>
        </Clause>

        <Clause n={3} title="What survives, and why">
          <p>
            Two things are not removed by a deletion request, and it is fair
            that you know before you ask.
          </p>
          <Points
            items={[
              <>
                <strong>Your opt-out.</strong> If you replied STOP, we keep the
                record that you opted out. Deleting it would let the automation
                message you again, which is the opposite of what you asked for.
                It holds no message content.
              </>,
              <>
                <strong>Anything on Meta.</strong> Your comment on a post and
                the messages in your Instagram or Messenger inbox live on
                Meta&apos;s systems, not ours. We can delete our copy, and we
                cannot delete theirs. To remove those, delete the comment
                yourself or use Meta&apos;s own tools for the conversation.
              </>,
            ]}
          />
        </Clause>

        <Clause n={4} title="If you are the business, not the customer">
          <p>
            A business that connected its Meta assets can delete everything
            itself, without contacting us. Removing a connection deletes every
            record beneath it: ad accounts, campaigns, ads, insights, creative
            analysis, conversations, leads and audit history. That is immediate
            and cannot be undone.
          </p>
          <p>
            You can also revoke our access entirely from your own Meta Business
            Settings by removing the asset assignment or the system user.
            Access ends the moment you do, with nothing required from us.
          </p>
        </Clause>

        <Clause n={5} title="Related">
          <p>
            The <Link href="/privacy">privacy policy</Link> explains what we
            collect and who processes it. The{" "}
            <Link href="/security">security page</Link> covers how it is
            protected while we hold it.
          </p>
        </Clause>
      </div>
    </LegalPage>
  );
}
