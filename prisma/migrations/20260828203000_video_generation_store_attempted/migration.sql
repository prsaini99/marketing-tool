-- Pairs with "storedAt", exactly as the Meta asset tables do: without a record
-- of the attempt, every poll of a clip we failed to store re-downloads the
-- whole file from the vendor. With it, a retry is spaced and eventually
-- stops (the vendor URL is dead after about seven days anyway).
ALTER TABLE "VideoGeneration" ADD COLUMN "storeAttemptedAt" TIMESTAMP(3);
