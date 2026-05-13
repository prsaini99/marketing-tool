import { PrismaClient } from "@prisma/client";

// Reuse one PrismaClient across Next.js dev hot-reloads.
// Without this, every reload spawns a new client and exhausts DB connections.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
