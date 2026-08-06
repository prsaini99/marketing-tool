-- Forensic log of EVERY inbound webhook POST, written before parsing and
-- before signature verification. Exists because "Meta never called us" and
-- "Meta called us and we dropped it" were indistinguishable, which stalled a
-- multi-day investigation into missing message webhooks.
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "objectType" TEXT,
    "signatureValid" BOOLEAN NOT NULL,
    "parsedCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "rawJson" JSONB NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookDelivery_receivedAt_idx" ON "WebhookDelivery"("receivedAt");
