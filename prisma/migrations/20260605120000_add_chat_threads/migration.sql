-- Persistent chat threads for the AI Assistant (/dashboard/chat).
-- See prisma/schema.prisma for the contract.

CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

-- Sidebar lists threads newest-first; index supports that path directly.
CREATE INDEX "ChatThread_updatedAt_idx" ON "ChatThread"("updatedAt" DESC);

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "toolCallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- Loading a thread streams messages in chronological order.
CREATE INDEX "ChatMessage_threadId_createdAt_idx"
    ON "ChatMessage"("threadId", "createdAt");

ALTER TABLE "ChatMessage"
    ADD CONSTRAINT "ChatMessage_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
