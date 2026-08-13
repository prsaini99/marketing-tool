-- CreateTable
CREATE TABLE "NotificationSetting" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "weeklyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "minSeverity" TEXT NOT NULL DEFAULT 'medium',
    "lastAlertDigestAt" TIMESTAMP(3),
    "lastWeeklySentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_adAccountId_key" ON "NotificationSetting"("adAccountId");

-- AddForeignKey
ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "MetaAdAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
