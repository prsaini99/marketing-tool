/**
 * Discovery service — orchestrates the "paste token → enumerate → persist" flow.
 *
 * Keyed on the token owner's FB id (Meta's /me id): re-pasting any token for
 * the same owner refreshes the existing Connection row instead of creating a
 * duplicate. Children (MetaBusiness / MetaAdAccount) are upserted too —
 * existing selectedForSync flags are preserved on update.
 *
 * Boundary rules:
 * - Calls Meta only via `metaClient` (PROJECT.md rule #1)
 * - Encrypts tokens before writing to DB (rule #5)
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient } from "@/lib/meta/client";
import { encryptToken } from "@/lib/meta/credentials";
import type { NormalizedDiscovery } from "@/lib/meta/types";

export interface CreateConnectionInput {
  token: string;
  label?: string;
}

export interface CreateConnectionResult {
  connectionId: string;
  discovery: NormalizedDiscovery;
}

export async function createConnectionFromToken(
  input: CreateConnectionInput,
): Promise<CreateConnectionResult> {
  if (!input.token || input.token.length < 20) {
    throw new Error("Token is required");
  }

  // 1. Validate token by calling Meta. If it's bad, this throws before we persist.
  const discovery = await metaClient.discoverWithToken(input.token);
  const encrypted = encryptToken(input.token);

  // 2. Upsert the Connection keyed on the token owner's FB id.
  //    Re-pasting a fresh token for the same identity rotates the ciphertext;
  //    children below stay intact, preserving selectedForSync flags.
  const connection = await prisma.connection.upsert({
    where: { tokenOwnerFbId: discovery.tokenOwner.id },
    create: {
      tokenOwnerFbId: discovery.tokenOwner.id,
      tokenOwnerName: discovery.tokenOwner.name,
      label: input.label,
      encryptedToken: encrypted.encryptedToken,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      scopes: [], // TODO: extract from /debug_token in Phase 1
      lastDiscoveredAt: new Date(),
    },
    update: {
      encryptedToken: encrypted.encryptedToken,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      lastDiscoveredAt: new Date(),
      tokenOwnerName: discovery.tokenOwner.name,
      ...(input.label !== undefined ? { label: input.label } : {}),
      status: "ACTIVE",
    },
  });

  // 3. Upsert each business + each ad account under it.
  //    Done sequentially because Prisma doesn't support nested upserts on
  //    create-many. Volume is small (one connection's worth of entities).
  for (const b of discovery.businesses) {
    const bm = await prisma.metaBusiness.upsert({
      where: {
        connectionId_metaBusinessId: {
          connectionId: connection.id,
          metaBusinessId: b.metaBusinessId,
        },
      },
      create: {
        connectionId: connection.id,
        metaBusinessId: b.metaBusinessId,
        name: b.name,
      },
      update: { name: b.name },
    });

    for (const a of b.adAccounts) {
      await prisma.metaAdAccount.upsert({
        where: {
          businessId_metaAdAccountId: {
            businessId: bm.id,
            metaAdAccountId: `act_${a.id}`,
          },
        },
        create: {
          businessId: bm.id,
          metaAdAccountId: `act_${a.id}`,
          name: a.name,
          currency: a.currency,
          timezone: a.timezone,
          status: a.status,
        },
        update: {
          name: a.name,
          currency: a.currency,
          timezone: a.timezone,
          status: a.status,
          // selectedForSync is deliberately NOT touched — user's prior choice
          // survives re-discovery.
        },
      });
    }
  }

  return { connectionId: connection.id, discovery };
}
