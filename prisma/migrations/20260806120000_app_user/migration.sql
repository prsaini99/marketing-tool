-- Database-backed login credentials (see AppUser in schema.prisma).
-- Lets the owner create and revoke logins — especially a self-expiring
-- reviewer account for Meta App Review — without a redeploy.
CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppUser_email_key" ON "AppUser"("email");
