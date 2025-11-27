/*
  Warnings:

  - You are about to drop the column `authorId` on the `Video` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Video" DROP CONSTRAINT "Video_authorId_fkey";

-- DropIndex
DROP INDEX "Video_authorId_idx";

-- AlterTable
ALTER TABLE "Video" DROP COLUMN "authorId";

-- CreateIndex
CREATE INDEX "Video_author_idx" ON "Video"("author");
