/**
 * Create a customer-list custom audience on Meta + mirror it locally.
 *
 * Two-step Meta flow:
 *   1. POST /act_X/customaudiences → empty CUSTOM audience container.
 *   2. POST /{audience_id}/users → upload hashed emails / phones.
 *
 * Privacy: plaintext PII arrives from the browser over HTTPS, is hashed
 * here (src/lib/meta/audience-hash.ts), and only SHA-256 hashes go to Meta.
 * Nothing about the contacts is persisted locally — we store only the
 * audience metadata Meta returns.
 *
 * Audit: an audience.create row is written before the Meta call (with the
 * NAME and contact COUNTS, never the contacts themselves) and stamped after.
 *
 * Note: Meta requires the ad account to have accepted the Custom Audience
 * Terms of Service before customer-list audiences can be created. If it
 * hasn't, Meta returns a specific error which we surface verbatim.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { metaClient, MetaApiError } from "@/lib/meta/client";
import { hashContactBlob } from "@/lib/meta/audience-hash";

export interface CreateCustomAudienceInput {
  metaAdAccountId: string;
  name: string;
  description?: string;
  // Raw, unhashed contact blobs from the form. Hashed here before upload.
  emailsBlob?: string;
  phonesBlob?: string;
}

export interface CreateCustomAudienceResult {
  metaAudienceId: string;
  emailsUploaded: number;
  phonesUploaded: number;
  skipped: number;
  numReceived: number;
}

export async function createCustomAudience(
  input: CreateCustomAudienceInput,
): Promise<CreateCustomAudienceResult> {
  const name = input.name?.trim();
  if (!name) throw new Error("name is required");

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

  // Hash the contacts up front so we can reject an entirely-empty upload
  // before creating an empty audience on Meta's side.
  const emails = input.emailsBlob
    ? hashContactBlob(input.emailsBlob, "email")
    : { hashes: [], skipped: 0 };
  const phones = input.phonesBlob
    ? hashContactBlob(input.phonesBlob, "phone")
    : { hashes: [], skipped: 0 };

  if (emails.hashes.length === 0 && phones.hashes.length === 0) {
    throw new Error(
      "Add at least one valid email or phone number to upload.",
    );
  }

  const connectionId = account.business.connection.id;

  const auditRow = await prisma.auditLog.create({
    data: {
      action: "audience.create",
      targetType: "audience",
      targetId: "(pending)",
      before: {},
      // Counts only — never the contacts themselves.
      after: {
        name,
        description: input.description ?? null,
        subtype: "CUSTOM",
        emailCount: emails.hashes.length,
        phoneCount: phones.hashes.length,
        _pending: true,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  // Step 1 — create the empty container.
  let created: { id: string };
  try {
    created = await metaClient.createCustomAudience(
      connectionId,
      account.metaAdAccountId,
      {
        name,
        subtype: "CUSTOM",
        description: input.description?.trim() || undefined,
        // Agency uploading its own CRM data.
        customer_file_source: "USER_PROVIDED_ONLY",
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
      data: {
        after: {
          name,
          _failed: true,
          _failedStep: "create_container",
          _error: message,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    throw err;
  }

  // Step 2 — upload hashed users. Email + phone go as separate batches
  // (different schemas). A failure here leaves an empty audience on Meta,
  // which is harmless and re-uploadable — we record it in the audit row.
  let numReceived = 0;
  try {
    if (emails.hashes.length > 0) {
      const r = await metaClient.addUsersToCustomAudience(
        connectionId,
        created.id,
        ["EMAIL"],
        emails.hashes.map((h) => [h]),
      );
      numReceived += r.numReceived;
    }
    if (phones.hashes.length > 0) {
      const r = await metaClient.addUsersToCustomAudience(
        connectionId,
        created.id,
        ["PHONE"],
        phones.hashes.map((h) => [h]),
      );
      numReceived += r.numReceived;
    }
  } catch (err) {
    const message =
      err instanceof MetaApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error";
    await prisma.auditLog.update({
      where: { id: auditRow.id },
      data: {
        targetId: created.id,
        after: {
          name,
          metaAudienceId: created.id,
          _failed: true,
          _failedStep: "upload_users",
          _error: message,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    throw err;
  }

  // Mirror the new audience locally so it shows on the Audiences page
  // immediately (operation_status will be PROCESSING until Meta finishes
  // matching — a later sync refreshes the count + status).
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
      subtype: "CUSTOM",
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
      after: {
        name,
        metaAudienceId: created.id,
        subtype: "CUSTOM",
        emailCount: emails.hashes.length,
        phoneCount: phones.hashes.length,
        numReceived,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    metaAudienceId: created.id,
    emailsUploaded: emails.hashes.length,
    phonesUploaded: phones.hashes.length,
    skipped: emails.skipped + phones.skipped,
    numReceived,
  };
}
