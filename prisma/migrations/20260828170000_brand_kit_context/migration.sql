-- Context for the copy stage: what the business sells, who buys it, and how
-- it should sound. Never rendered onto the image — brandName and tagline are
-- the fields drawn as on-image text; these shape the copy that gets written.
ALTER TABLE "BrandKit" ADD COLUMN "description" TEXT;
ALTER TABLE "BrandKit" ADD COLUMN "audience" TEXT;
ALTER TABLE "BrandKit" ADD COLUMN "toneOfVoice" TEXT;
