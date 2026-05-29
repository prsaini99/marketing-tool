/**
 * Create a custom conversion on Meta + mirror it locally.
 *
 *   1. Build the rule JSON from the caller's rule spec.
 *   2. AuditLog row BEFORE the Meta call.
 *   3. POST /act_X/customconversions.
 *   4. Mirror the new conversion into our CustomConversion table so it shows
 *      on the Conversions page + Create Ad Set picker immediately.
 *
 * Rule shapes we generate (Meta's predicate format):
 *   • URL contains  → {"url":{"i_contains":"<value>"}}
 *   • URL equals    → {"url":{"i_eq":"<value>"}}
 *   • Event equals  → {"event":{"eq":"<value>"}}
 *
 * event_source_id (the Pixel) is required by Meta — a custom conversion is
 * always built on top of a pixel's event stream.
 */

import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";

export type ConversionRuleType = "url_contains" | "url_equals" | "event_equals";

export interface CreateCustomConversionInput {
  metaAdAccountId: string;
  name: string;
  description?: string;
  pixelId: string; // event_source_id
  customEventType: string; // PURCHASE | LEAD | OTHER | …
  ruleType: ConversionRuleType;
  ruleValue: string;
}

export interface CreateCustomConversionResult {
  metaConversionId: string;
}

function buildRule(
  ruleType: ConversionRuleType,
  value: string,
): Record<string, unknown> {
  const v = value.trim();
  switch (ruleType) {
    case "url_contains":
      return { url: { i_contains: v } };
    case "url_equals":
      return { url: { i_eq: v } };
    case "event_equals":
      return { event: { eq: v } };
  }
}

export async function createCustomConversion(
  input: CreateCustomConversionInput,
): Promise<CreateCustomConversionResult> {
  const name = input.name?.trim();
  if (!name) throw new Error("name is required");
  if (!input.pixelId?.trim()) throw new Error("A pixel is required");
  if (!input.ruleValue?.trim()) throw new Error("Rule value is required");

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

  const rule = buildRule(input.ruleType, input.ruleValue);
  const ruleJson = JSON.stringify(rule);

  const intent = {
    name,
    description: input.description ?? null,
    pixelId: input.pixelId,
    customEventType: input.customEventType,
    rule: ruleJson,
  };

  const auditRow = await prisma.auditLog.create({
    data: {
      action: "conversion.create",
      targetType: "conversion",
      targetId: "(pending)",
      before: {},
      after: { ...intent, _pending: true },
    },
  });

  let created: { id: string };
  try {
    created = await metaClient.createCustomConversion(
      account.business.connection.id,
      account.metaAdAccountId,
      {
        name,
        description: input.description?.trim() || undefined,
        event_source_id: input.pixelId.trim(),
        custom_event_type: input.customEventType,
        rule,
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

  await prisma.customConversion.upsert({
    where: {
      adAccountId_metaConversionId: {
        adAccountId: account.id,
        metaConversionId: created.id,
      },
    },
    create: {
      adAccountId: account.id,
      metaConversionId: created.id,
      name,
      description: input.description?.trim() || null,
      rule: ruleJson,
      customEventType: input.customEventType,
      eventSourceId: input.pixelId.trim(),
      metaCreatedTime: new Date(),
      syncedAt: new Date(),
    },
    update: {
      name,
      description: input.description?.trim() || null,
      rule: ruleJson,
      customEventType: input.customEventType,
      eventSourceId: input.pixelId.trim(),
      syncedAt: new Date(),
    },
  });

  await prisma.auditLog.update({
    where: { id: auditRow.id },
    data: {
      targetId: created.id,
      after: { ...intent, metaConversionId: created.id },
    },
  });

  return { metaConversionId: created.id };
}
