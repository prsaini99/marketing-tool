/**
 * IG account discovery — persists what lib/meta/instagram discovers.
 * Upserts keyed on igUserId: re-running discovery refreshes username/page
 * linkage without touching botEnabled, rules, or the bot profile.
 */

import { prisma } from "@/lib/db/prisma";
import { discoverInstagramAccounts } from "@/lib/meta/instagram";

export async function discoverIgAccountsForConnection(
  connectionId: string,
): Promise<{ found: number }> {
  const discovered = await discoverInstagramAccounts(connectionId);
  for (const d of discovered) {
    await prisma.instagramAccount.upsert({
      where: { igUserId: d.igUserId },
      create: {
        igUserId: d.igUserId,
        username: d.username,
        linkedPageId: d.linkedPageId,
        connectionId,
      },
      update: {
        username: d.username,
        linkedPageId: d.linkedPageId,
        connectionId,
      },
    });
  }
  return { found: discovered.length };
}
