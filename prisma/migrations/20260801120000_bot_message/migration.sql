CREATE TABLE "BotMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "metaMid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BotMessage_metaMid_key" ON "BotMessage"("metaMid");
CREATE INDEX "BotMessage_threadId_createdAt_idx" ON "BotMessage"("threadId", "createdAt");

ALTER TABLE "BotMessage" ADD CONSTRAINT "BotMessage_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "BotThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
