import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { RulesManager } from "@/components/automation/rules-manager";

export const dynamic = "force-dynamic";

export default async function RulesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await prisma.instagramAccount.findUnique({
    where: { id },
    include: { rules: { orderBy: { priority: "asc" } } },
  });
  if (!account) notFound();

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Rules — @{account.username}
        </h1>
        <p className="text-sm text-muted-foreground">
          First match wins (top = lowest priority number). A matched rule can
          fire both a public reply and a DM. Comment&rarr;DM sends ONE message
          only &mdash; put the whole offer in it.
        </p>
      </div>
      <RulesManager
        accountId={account.id}
        initialRules={account.rules.map((r) => ({
          id: r.id,
          enabled: r.enabled,
          priority: r.priority,
          triggerType: r.triggerType,
          keywords: r.keywords,
          mediaId: r.mediaId,
          publicReplyEnabled: r.publicReplyEnabled,
          publicReplyTemplate: r.publicReplyTemplate,
          dmEnabled: r.dmEnabled,
          dmTemplate: r.dmTemplate,
          aiFallback: r.aiFallback,
          oncePerUser: r.oncePerUser,
        }))}
      />
    </div>
  );
}
