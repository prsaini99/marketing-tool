/**
 * Account discovery — persists what lib/meta/messaging discovers.
 *
 * Upserts on (platform, accountId): re-running refreshes the display name
 * and Page linkage without touching botEnabled, rules, or the bot profile.
 * Instagram accounts and Facebook Pages are separate rows even when the IG
 * account is linked to the very Page next to it — they are separate
 * surfaces with their own rules and their own audit trail.
 */

import { prisma } from "@/lib/db/prisma";
import {
  discoverFacebookPages,
  discoverInstagramAccounts,
} from "@/lib/meta/messaging";

export async function discoverAccountsForConnection(
  connectionId: string,
): Promise<{ instagram: number; facebook: number }> {
  const igAccounts = await discoverInstagramAccounts(connectionId);
  for (const d of igAccounts) {
    await prisma.socialAccount.upsert({
      where: {
        platform_accountId: { platform: "INSTAGRAM", accountId: d.igUserId },
      },
      create: {
        platform: "INSTAGRAM",
        accountId: d.igUserId,
        displayName: d.username,
        linkedPageId: d.linkedPageId,
        connectionId,
      },
      update: {
        displayName: d.username,
        linkedPageId: d.linkedPageId,
        connectionId,
      },
    });
  }

  const pages = await discoverFacebookPages(connectionId);
  for (const p of pages) {
    await prisma.socialAccount.upsert({
      where: {
        platform_accountId: { platform: "FACEBOOK", accountId: p.pageId },
      },
      create: {
        platform: "FACEBOOK",
        accountId: p.pageId,
        displayName: p.name,
        // A Page IS its own page for send-scoping purposes.
        linkedPageId: p.pageId,
        connectionId,
      },
      update: {
        displayName: p.name,
        linkedPageId: p.pageId,
        connectionId,
      },
    });
  }

  return { instagram: igAccounts.length, facebook: pages.length };
}
