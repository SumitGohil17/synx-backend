-- CreateIndex
CREATE INDEX "shortsVideo_authorId_idx" ON "shortsVideo"("authorId");

-- AddForeignKey
ALTER TABLE "shortsVideo" ADD CONSTRAINT "shortsVideo_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
