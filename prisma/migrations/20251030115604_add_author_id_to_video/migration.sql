/*
  Warnings:

  - Added the required column `authorId` to the `Video` table without a default value. This is not possible if the table is not empty.

*/

-- First, create a default user if no users exist
INSERT INTO "User" (id, email, username, password, "createdAt", "updatedAt")
SELECT 'default-user-' || to_char(now(), 'YYYYMMDDHHmmss'), 'default@synx.local', 'default_user', 'default', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "User");

-- AlterTable - Add authorId column making it nullable first
ALTER TABLE "Video" ADD COLUMN "authorId" TEXT;

-- Update existing videos to use the first user
UPDATE "Video" SET "authorId" = (SELECT id FROM "User" LIMIT 1) WHERE "authorId" IS NULL;

-- Now make the column NOT NULL
ALTER TABLE "Video" ALTER COLUMN "authorId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Video_authorId_idx" ON "Video"("authorId");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
