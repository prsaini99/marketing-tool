/**
 * Create a LOOKALIKE custom audience on Meta + mirror locally.
 *
 * A lookalike clones an existing "source" audience — Meta finds new people
 * similar to the source within a chosen country, at a chosen size ratio
 * (1% = most similar/narrowest, up to 10% = broadest).
 *
 * Unlike website/engagement (rule-based, where Meta rejects an explicit
 * `subtype`), lookalikes are NOT rule-based — they're defined by
 * origin_audience_id + lookalike_spec — so we DO send subtype=LOOKALIKE
 * per Meta's docs.
 *
 * Prereq Meta enforces: the source audience must have ~100+ matched people
 * in the chosen country, else Meta rejects. Surfaced verbatim on failure.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export interface CreateLookalikeAudienceInput {
  metaAdAccountId: string;
  name: string;
  description?: string;
  originAudienceId: string; // source custom audience id
  country: string; // ISO-2, e.g. "US"
  ratio: number; // 0.01 .. 0.10
}

export interface CreateLookalikeAudienceResult {
  metaAudienceId: string;
}

export async function createLookalikeAudience(
  input: CreateLookalikeAudienceInput,
): Promise<CreateLookalikeAudienceResult> {
  const name = input.name?.trim();
  if (!name) throw new Error("name is required");
  if (!input.originAudienceId?.trim()) {
    throw new Error("A source audience is required");
  }
  const country = input.country?.trim().toUpperCase();
  if (!country) throw new Error("A country is required");
  // Clamp to Meta's accepted lookalike range.
  const ratio = Math.min(Math.max(input.ratio, 0.01), 0.2);

  const account = await prisma.metaAdAccount.findFirst({
    where: {
      metaAdAccountId: input.metaAdAccountId.startsWith("act_")
        ? input.metaAdAccountId
        : `act_${input.metaAdAccountId}`,
      selectedForSync: true,
    },
    include: { business: { include: { connection: true } } },
  });
  if (!account) {
    throw new Error("Ad account not found or not selected for sync");
  }

  const lookalikeSpec = { type: "similarity", country, ratio };

  const intent = {
    name,
    subtype: "LOOKALIKE",
    originAudienceId: input.originAudienceId,
    country,
    ratio,
  };

  const auditRow = await prisma.auditLog.create({
    data: {
      action: "audience.create",
      targetType: "audience",
      targetId: "(pending)",
      before: {},
      after: { ...intent, _pending: true },
    },
  });

  let created: { id: string };
  try {
    created = await metaClient.createCustomAudience(
      account.business.connection.id,
      account.metaAdAccountId,
      {
        name,
        subtype: "LOOKALIKE",
        description: input.description?.trim() || undefined,
        origin_audience_id: input.originAudienceId.trim(),
        lookalike_spec: lookalikeSpec,
      },
    );
  } catch (err) {
    const message =
      err instanceof MetaApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    await prisma.auditLog.update({
      where: { id: auditRow.id },
      data: { after: { ...intent, _failed: true, _error: message } },
    });
    throw err;
  }

  await prisma.customAudience.upsert({
    where: {
      adAccountId_metaAudienceId: {
        adAccountId: account.id,
        metaAudienceId: created.id,
      },
    },
    create: {
      adAccountId: account.id,
      metaAudienceId: created.id,
      name,
      subtype: "LOOKALIKE",
      description: input.description?.trim() || null,
      operationStatus: "PROCESSING",
      approximateCount: null,
      metaCreatedTime: new Date(),
      syncedAt: new Date(),
    },
    update: {
      name,
      description: input.description?.trim() || null,
      syncedAt: new Date(),
    },
  });

  await prisma.auditLog.update({
    where: { id: auditRow.id },
    data: {
      targetId: created.id,
      after: { ...intent, metaAudienceId: created.id },
    },
  });

  return { metaAudienceId: created.id };
}
