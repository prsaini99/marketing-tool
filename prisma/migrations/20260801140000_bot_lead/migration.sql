CREATE TABLE "BotLead" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "requirement" TEXT,
    "budget" TEXT,
    "timeline" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotLead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BotLead_threadId_key" ON "BotLead"("threadId");

ALTER TABLE "BotLead" ADD CONSTRAINT "BotLead_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "BotThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BotThread" ADD COLUMN "flagReason" TEXT;
ALTER TABLE "BotThread" ADD COLUMN "flaggedAt" TIMESTAMP(3);
ALTER TABLE "BotThread" ADD COLUMN "resolvedAt" TIMESTAMP(3);
