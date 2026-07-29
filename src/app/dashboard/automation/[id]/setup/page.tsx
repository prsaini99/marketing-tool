import { prisma } from "@/lib/db/prisma";
import { SetupChecklist } from "@/components/automation/setup-checklist";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SetupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await prisma.instagramAccount.findUnique({
    where: { id },
    select: { id: true, username: true },
  });
  if (!account) notFound();

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Setup — @{account.username}
        </h1>
        <p className="text-sm text-muted-foreground">
          Everything Meta needs before the bot can listen and reply. Green =
          done; red = action needed on your side.
        </p>
      </div>
      <SetupChecklist accountId={account.id} />
    </div>
  );
}
