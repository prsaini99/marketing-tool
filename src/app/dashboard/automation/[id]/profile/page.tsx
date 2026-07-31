import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { ProfileForm } from "@/components/automation/profile-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await prisma.socialAccount.findUnique({
    where: { id },
    include: { profile: { include: { faqs: { orderBy: { sortOrder: "asc" } } } } },
  });
  if (!account) notFound();

  const p = account.profile;
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Bot profile —{" "}
          {account.platform === "FACEBOOK"
            ? account.displayName
            : `@${account.displayName}`}
        </h1>
        <p className="text-sm text-muted-foreground">
          This is everything the AI is allowed to know. Facts, links, and
          FAQs not listed here will not appear in AI replies.
        </p>
      </div>
      <ProfileForm
        accountId={account.id}
        initial={{
          businessDescription: p?.businessDescription ?? "",
          toneRules: p?.toneRules ?? "",
          links: (p?.linksJson as Record<string, string>) ?? {},
          bannedTopics: p?.bannedTopics ?? [],
          languageMode: p?.languageMode ?? "mirror",
          aiFallbackEnabled: p?.aiFallbackEnabled ?? false,
          optOutConfirmation:
            p?.optOutConfirmation ??
            "You've been unsubscribed and won't receive more messages.",
          faqs: (p?.faqs ?? []).map((f) => ({
            question: f.question,
            answer: f.answer,
          })),
        }}
      />
    </div>
  );
}
