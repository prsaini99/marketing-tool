/**
 * Create a WEBSITE (pixel-based) custom audience on Meta + mirror locally.
 *
 * Unlike the customer-list flow (hash + 2-step upload), a website audience
 * is a single create call carrying a pixel rule — Meta then continuously
 * populates it from the pixel's traffic. No PII passes through us.
 *
 * Rule shape (Meta's flexible spec):
 *   {
 *     "inclusions": {
 *       "operator": "or",
 *       "rules": [{
 *         "event_sources": [{ "id": "<pixel>", "type": "pixel" }],
 *         "retention_seconds": <days * 86400>,
 *         "filter": {                              // omitted = all visitors
 *           "operator": "and",
 *           "filters": [{ "field": "url", "operator": "i_contains",
 *                         "value": "<fragment>" }]
 *         }
 *       }]
 *     }
 *   }
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export interface CreateWebsiteAudienceInput {
  metaAdAccountId: string;
  name: string;
  description?: string;
  pixelId: string;
  retentionDays: number; // 1..180
  // Optional URL filter; blank = all site visitors.
  urlContains?: string;
}

export interface CreateWebsiteAudienceResult {
  metaAudienceId: string;
}

// Meta caps website-audience retention at 180 days.
const MAX_RETENTION_DAYS = 180;

export async function createWebsiteAudience(
  input: CreateWebsiteAudienceInput,
): Promise<CreateWebsiteAudienceResult> {
  const name = input.name?.trim();
  if (!name) throw new Error("name is required");
  if (!input.pixelId?.trim()) throw new Error("A pixel is required");
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

  // Meta rejects a rule with no filter (error 1713098). So we ALWAYS attach
  // a URL filter:
  //   • "URL contains X"  → matches that fragment
  //   • "all visitors"    → matches "http", i.e. every tracked page load —
  //     a robust stand-in for "anyone who visited", independent of which
  //     pixel events fire.
  const urlContains = input.urlContains?.trim();
  const filterValue = urlContains && urlContains.length > 0 ? urlContains : "http";
  const ruleEntry: Record<string, unknown> = {
    event_sources: [{ id: input.pixelId.trim(), type: "pixel" }],
    retention_seconds: retentionDays * 86400,
    filter: {
      operator: "and",
      filters: [{ field: "url", operator: "i_contains", value: filterValue }],
    },
  };
  const rule = { inclusions: { operator: "or", rules: [ruleEntry] } };
  const ruleJson = JSON.stringify(rule);

  const intent = {
    name,
    subtype: "WEBSITE",
    pixelId: input.pixelId,
    retentionDays,
    urlContains: urlContains ?? null,
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
        // NOTE: do NOT send `subtype` here. For rule-based (website)
        // audiences Meta infers the type from `rule` and rejects an
        // explicit subtype in v23.0 (error 2654/1870053). Only
        // customer-list audiences take subtype=CUSTOM.
        description: input.description?.trim() || undefined,
        rule,
        // Backfill from existing pixel traffic so the audience isn't empty.
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
      subtype: "WEBSITE",
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
