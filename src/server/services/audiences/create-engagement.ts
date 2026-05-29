/**
 * Create an ENGAGEMENT custom audience (Facebook Page engagement) + mirror
 * locally. People who interacted with the Page — visited, engaged, or
 * messaged — within a retention window.
 *
 * Rule-based like website audiences, so (per what we learned with WEBSITE)
 * we do NOT send an explicit `subtype` — Meta infers it from the rule's
 * `event_sources[].type = "page"`. Sending subtype on a rule-based audience
 * triggers error 2654/1870053.
 *
 * Engagement event values map to Meta's page engagement filters:
 *   • page_engaged  — any interaction with the Page or its posts
 *   • page_visited  — visited the Page profile
 *   • page_messaged — sent the Page a message
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export type EngagementEvent =
  | "page_engaged"
  | "page_visited"
  | "page_messaged";

export interface CreateEngagementAudienceInput {
  metaAdAccountId: string;
  name: string;
  description?: string;
  pageId: string;
  event: EngagementEvent;
  retentionDays: number; // 1..365 (Meta allows up to 365 for engagement)
}

export interface CreateEngagementAudienceResult {
  metaAudienceId: string;
}

const MAX_RETENTION_DAYS = 365;

export async function createEngagementAudience(
  input: CreateEngagementAudienceInput,
): Promise<CreateEngagementAudienceResult> {
  const name = input.name?.trim();
  if (!name) throw new Error("name is required");
  if (!input.pageId?.trim()) throw new Error("A Facebook Page is required");
  const retentionDays = Math.min(
    Math.max(Math.round(input.retentionDays), 1),
    MAX_RETENTION_DAYS,
  );

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

  const rule = {
    inclusions: {
      operator: "or",
      rules: [
        {
          event_sources: [{ id: input.pageId.trim(), type: "page" }],
          retention_seconds: retentionDays * 86400,
          filter: {
            operator: "or",
            filters: [{ field: "event", operator: "eq", value: input.event }],
          },
        },
      ],
    },
  };
  const ruleJson = JSON.stringify(rule);

  const intent = {
    name,
    subtype: "ENGAGEMENT",
    pageId: input.pageId,
    event: input.event,
    retentionDays,
    rule: ruleJson,
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
        description: input.description?.trim() || undefined,
        rule,
        prefill: true,
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
      subtype: "ENGAGEMENT",
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
