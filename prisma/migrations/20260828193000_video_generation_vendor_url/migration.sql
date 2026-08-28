-- The vendor's own download link for a finished clip. Kept so that a paid
-- generation whose bytes we failed to copy into Supabase is still reachable
-- (for about seven days, after which Higgsfield deletes it), and so a later
-- poll can retry the copy rather than asking the operator to pay again.
ALTER TABLE "VideoGeneration" ADD COLUMN "vendorUrl" TEXT;
