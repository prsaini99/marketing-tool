-- CreateTable
CREATE TABLE "InstagramAccount" (
    "id" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "linkedPageId" TEXT,
    "connectionId" TEXT NOT NULL,
    "botEnabled" BOOLEAN NOT NULL DEFAULT false,
    "webhookSubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotProfile" (
    "id" TEXT NOT NULL,
    "igAccountId" TEXT NOT NULL,
    "businessDescription" TEXT NOT NULL DEFAULT '',
    "toneRules" TEXT NOT NULL DEFAULT '',
    "linksJson" JSONB NOT NULL DEFAULT '{}',
    "bannedTopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languageMode" TEXT NOT NULL DEFAULT 'mirror',
    "aiFallbackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "optOutConfirmation" TEXT NOT NULL DEFAULT 'You''ve been unsubscribed and won''t receive more messages.',

    CONSTRAINT "BotProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotFaq" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BotFaq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotRule" (
    "id" TEXT NOT NULL,
    "igAccountId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "triggerType" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mediaId" TEXT,
    "publicReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publicReplyTemplate" TEXT NOT NULL DEFAULT '',
    "dmEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dmTemplate" TEXT NOT NULL DEFAULT '',
    "aiFallback" BOOLEAN NOT NULL DEFAULT false,
    "oncePerUser" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BotRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotThread" (
    "id" TEXT NOT NULL,
    "igAccountId" TEXT NOT NULL,
    "igsid" TEXT NOT NULL,
    "lastInboundAt" TIMESTAMP(3),
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "recentMessagesJson" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "BotThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "igAccountId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromIgsid" TEXT,
    "fromUsername" TEXT,
    "text" TEXT,
    "commentId" TEXT,
    "mediaId" TEXT,
    "rawJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationLog" (
    "id" TEXT NOT NULL,
    "eventDbId" TEXT NOT NULL,
    "matchedRuleId" TEXT,
    "action" TEXT NOT NULL,
    "renderedText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "skipReason" TEXT,
    "metaError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "AutomationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAccount_igUserId_key" ON "InstagramAccount"("igUserId");

-- CreateIndex
CREATE UNIQUE INDEX "BotProfile_igAccountId_key" ON "BotProfile"("igAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BotThread_igAccountId_igsid_key" ON "BotThread"("igAccountId", "igsid");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationEvent_eventId_key" ON "AutomationEvent"("eventId");

-- AddForeignKey
ALTER TABLE "InstagramAccount" ADD CONSTRAINT "InstagramAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotProfile" ADD CONSTRAINT "BotProfile_igAccountId_fkey" FOREIGN KEY ("igAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotFaq" ADD CONSTRAINT "BotFaq_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BotProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotRule" ADD CONSTRAINT "BotRule_igAccountId_fkey" FOREIGN KEY ("igAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotThread" ADD CONSTRAINT "BotThread_igAccountId_fkey" FOREIGN KEY ("igAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationEvent" ADD CONSTRAINT "AutomationEvent_igAccountId_fkey" FOREIGN KEY ("igAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationLog" ADD CONSTRAINT "AutomationLog_eventDbId_fkey" FOREIGN KEY ("eventDbId") REFERENCES "AutomationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

